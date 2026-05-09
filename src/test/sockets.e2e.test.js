const { createServer } = require('http')
const { Server } = require('socket.io')
const Client = require('socket.io-client')
const { SignJWT } = require('jose')

const SECRET = 'test_jwt_secret'
process.env.JWT_SECRET = SECRET
process.env.ROUND_MS = '500' // short rounds keep the test fast

const registerSocketHandlers = require('../sockets')
const { questions } = require('../assets/Questions')

async function makeToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(SECRET))
}

function waitFor(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout waiting for ${event}`)),
      timeoutMs
    )
    socket.once(event, (payload) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
}

function connectClient(port, token) {
  return Client(`http://localhost:${port}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  })
}

describe('sockets e2e', () => {
  let httpServer
  let io
  let port
  let rooms

  beforeAll((done) => {
    httpServer = createServer()
    io = new Server(httpServer)
    registerSocketHandlers(io)
    rooms = registerSocketHandlers.__rooms
    httpServer.listen(0, () => {
      port = httpServer.address().port
      done()
    })
  })

  afterAll((done) => {
    io.close()
    httpServer.close(done)
  })

  afterEach(() => {
    // Clear room state between tests so each test starts fresh.
    for (const id of Array.from(rooms.keys())) {
      registerSocketHandlers.__destroyRoom(id)
    }
  })

  test('happy path: join → start → submit → end → next → gameOver', async () => {
    const tokenA = await makeToken({ id: 'userA', email: 'a@x.com' })
    const tokenB = await makeToken({ id: 'userB', email: 'b@x.com' })
    const a = connectClient(port, tokenA)
    const b = connectClient(port, tokenB)

    try {
      await Promise.all([waitFor(a, 'connect'), waitFor(b, 'connect')])

      const roomId = 'room-happy'

      // A joins first → admin
      const aSync = waitFor(a, 'syncState')
      a.emit('joinRoom', { roomId, nickName: 'Alice', img: '' })
      const snapA = await aSync
      expect(snapA.adminId).toBe('userA')
      expect(snapA.players.map((p) => p.playerId)).toEqual(['userA'])

      // B joins → A receives playerJoined for B
      const aSawB = waitFor(a, 'playerJoined')
      const bSync = waitFor(b, 'syncState')
      b.emit('joinRoom', { roomId, nickName: 'Bob', img: '' })
      const [bJoined, snapB] = await Promise.all([aSawB, bSync])
      expect(bJoined.playerId).toBe('userB')
      expect(snapB.adminId).toBe('userA')

      // Non-admin B tries startGame — silently ignored.
      // We listen for roundStart on A; expect timeout (so we have to assert positively
      // by also racing a small delay).
      let bGotRoundStart = false
      a.once('roundStart', () => { bGotRoundStart = true })
      b.emit('startGame')
      await new Promise((r) => setTimeout(r, 50))
      expect(bGotRoundStart).toBe(false)

      // Admin A starts → both see roundStart with qIndex=0
      const aRoundStart = waitFor(a, 'roundStart')
      const bRoundStart = waitFor(b, 'roundStart')
      a.emit('startGame')
      const [aRS, bRS] = await Promise.all([aRoundStart, bRoundStart])
      expect(aRS.qIndex).toBe(0)
      expect(bRS.qIndex).toBe(0)
      expect(typeof aRS.serverNow).toBe('number')

      // A submits — server-derived playerId; client-supplied playerId is ignored.
      const aAnswerAdded = waitFor(a, 'answerAdded')
      a.emit('submitAnswer', {
        qIndex: 0,
        score: 1,
        time: 1.0,
        playerId: 'IM-NOT-USERA-IM-EVIL', // should be ignored
      })
      const ans = await aAnswerAdded
      expect(ans.playerId).toBe('userA')
      expect(ans.score).toBe(1)

      // A submits again for the same qIndex — idempotent (no second answerAdded).
      let secondAnswer = false
      a.once('answerAdded', () => { secondAnswer = true })
      a.emit('submitAnswer', { qIndex: 0, score: 1, time: 5 })
      await new Promise((r) => setTimeout(r, 50))
      expect(secondAnswer).toBe(false)

      // B submits → all-answered triggers early roundEnd on both clients.
      const aRoundEnd = waitFor(a, 'roundEnd')
      const bRoundEnd = waitFor(b, 'roundEnd')
      b.emit('submitAnswer', { qIndex: 0, score: 1, time: 3 })
      const [aRE, bRE] = await Promise.all([aRoundEnd, bRoundEnd])
      expect(aRE.qIndex).toBe(0)
      expect(aRE.winnerAnswerId).toBe('userA-0') // A had time=1, B had time=3
      expect(bRE.winnerAnswerId).toBe('userA-0')

      // Burn through remaining questions to reach gameOver.
      const total = questions.length
      for (let q = 1; q < total; q++) {
        const nextRoundA = waitFor(a, 'roundStart')
        a.emit('nextQuestion')
        await nextRoundA

        const aEnd = waitFor(a, 'roundEnd')
        const bEnd = waitFor(b, 'roundEnd')
        a.emit('submitAnswer', { qIndex: q, score: 1, time: 1 })
        b.emit('submitAnswer', { qIndex: q, score: 0, time: 5 })
        await Promise.all([aEnd, bEnd])
      }

      // After last question's REVEAL, nextQuestion should yield gameOver.
      const aGameOver = waitFor(a, 'gameOver')
      const bGameOver = waitFor(b, 'gameOver')
      a.emit('nextQuestion')
      const [goA, goB] = await Promise.all([aGameOver, bGameOver])
      expect(Array.isArray(goA.scoreboard)).toBe(true)
      expect(goA.scoreboard.length).toBe(2)
      // A had 1.0s every round, B had 5s only when correct (only Q0 was correct, time 3).
      // A should be ranked first (higher totalScore).
      expect(goA.scoreboard[0].playerId).toBe('userA')
      expect(goB.scoreboard[0].playerId).toBe('userA')
    } finally {
      a.close()
      b.close()
    }
  }, 15000)

  test('rejects connection without auth token', async () => {
    const bad = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    })
    try {
      const err = await new Promise((resolve, reject) => {
        bad.on('connect_error', resolve)
        bad.on('connect', () => reject(new Error('should not connect')))
        setTimeout(() => reject(new Error('timeout')), 1500)
      })
      expect(String(err.message || err)).toMatch(/auth/i)
    } finally {
      bad.close()
    }
  })

  test('syncRequest replies with current snapshot', async () => {
    const token = await makeToken({ id: 'userS', email: 's@x.com' })
    const c = connectClient(port, token)
    try {
      await waitFor(c, 'connect')
      const sync1 = waitFor(c, 'syncState')
      c.emit('joinRoom', { roomId: 'room-sync', nickName: 'S', img: '' })
      await sync1

      const sync2 = waitFor(c, 'syncState')
      c.emit('syncRequest')
      const snap = await sync2
      expect(snap.adminId).toBe('userS')
      expect(snap.phase).toBe('WAITING')
    } finally {
      c.close()
    }
  })
})
