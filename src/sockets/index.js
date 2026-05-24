const { verifyJwt } = require('../middleware/auth')
const {
  createRoom,
  reduceJoin,
  reduceLeave,
  reduceStartGame,
  reduceSubmit,
  reduceTimeout,
  reduceNextQuestion,
  snapshot,
} = require('./state')
const { sanitizeNickName, sanitizeImgUrl } = require('./sanitize')
const { questions } = require('../assets/Questions')

const QUESTIONS_COUNT = questions.length
const ROUND_MS = Number(process.env.ROUND_MS) || 30_000
const GRACE_MS = 250
const ROOM_REAPER_MS = 60_000

// roomId -> { state, timerHandle, reaperHandle, sockets: Map<userId, socket> }
const rooms = new Map()

function getOrCreateRoom(roomId, questionsCount) {
  let meta = rooms.get(roomId)
  if (meta) return meta
  const count =
    Number.isInteger(questionsCount) && questionsCount > 0 && questionsCount <= 200
      ? questionsCount
      : QUESTIONS_COUNT
  meta = {
    state: createRoom({ questionsCount: count, now: Date.now() }),
    timerHandle: null,
    reaperHandle: null,
    sockets: new Map(),
  }
  rooms.set(roomId, meta)
  return meta
}

function destroyRoom(roomId) {
  const meta = rooms.get(roomId)
  if (!meta) return
  if (meta.timerHandle) clearTimeout(meta.timerHandle)
  if (meta.reaperHandle) clearTimeout(meta.reaperHandle)
  rooms.delete(roomId)
}

function applyEffects(io, roomId, effects, meta) {
  for (const e of effects) {
    if (e.type === 'broadcast') {
      io.to(roomId).emit(e.event, e.payload)
    } else if (e.type === 'clearTimer') {
      if (meta.timerHandle) {
        clearTimeout(meta.timerHandle)
        meta.timerHandle = null
      }
    } else if (e.type === 'startTimer') {
      if (meta.timerHandle) clearTimeout(meta.timerHandle)
      meta.timerHandle = setTimeout(() => {
        // The room may have been reaped while the timer was queued.
        if (rooms.get(roomId) !== meta) return
        meta.timerHandle = null
        const { state, effects: outEffects } = reduceTimeout(meta.state)
        meta.state = state
        applyEffects(io, roomId, outEffects, meta)
      }, e.ms)
    }
  }
}

function scheduleReaperIfEmpty(roomId, meta) {
  const anyConnected = Object.values(meta.state.players).some((p) => p.connected)
  if (anyConnected) return
  if (meta.reaperHandle) clearTimeout(meta.reaperHandle)
  meta.reaperHandle = setTimeout(() => {
    if (rooms.get(roomId) !== meta) return
    const stillEmpty = Object.values(meta.state.players).every((p) => !p.connected)
    if (stillEmpty) destroyRoom(roomId)
  }, ROOM_REAPER_MS)
}

function cancelReaper(meta) {
  if (meta.reaperHandle) {
    clearTimeout(meta.reaperHandle)
    meta.reaperHandle = null
  }
}

module.exports = function registerSocketHandlers(io) {
  io.use((socket, next) => {
  socket.data.user = {
    id: socket.id,
  }

  next()
})

  io.on('connection', (socket) => {
    const userId = socket.data.user.id

    socket.on('joinRoom', ({ roomId, nickName, img, questionsCount } = {}) => {
      if (!roomId || typeof roomId !== 'string') return
      const cleanNick = sanitizeNickName(nickName) || 'Player'
      const cleanImg = sanitizeImgUrl(img)

      const meta = getOrCreateRoom(roomId, questionsCount)
     
      meta.sockets.set(userId, socket)
      cancelReaper(meta)

      socket.data.roomId = roomId
      socket.join(roomId)

      const now = Date.now()
      const result = reduceJoin(meta.state, {
        playerId: userId,
        nickName: cleanNick,
        img: cleanImg,
        now,
      })
      meta.state = result.state
      applyEffects(io, roomId, result.effects, meta)

      socket.emit('syncState', snapshot(meta.state, { now: Date.now() }))
    })

    socket.on('startGame', () => {
      const roomId = socket.data.roomId
      if (!roomId) return
      const meta = rooms.get(roomId)
      if (!meta) return
      const result = reduceStartGame(meta.state, {
        playerId: userId,
        now: Date.now(),
        roundMs: ROUND_MS,
      })
      meta.state = result.state
      applyEffects(io, roomId, result.effects, meta)
    })

    socket.on('submitAnswer', (payload = {}) => {
      const roomId = socket.data.roomId
      if (!roomId) return
      const meta = rooms.get(roomId)
      if (!meta) return
      const { qIndex, score, time, optionId } = payload
      const result = reduceSubmit(meta.state, {
        playerId: userId,
        qIndex,
        score,
        time,
        optionId,
        now: Date.now(),
        roundMs: ROUND_MS,
        graceMs: GRACE_MS,
      })
      meta.state = result.state
      applyEffects(io, roomId, result.effects, meta)
    })

    socket.on('nextQuestion', () => {
      const roomId = socket.data.roomId
      if (!roomId) return
      const meta = rooms.get(roomId)
      if (!meta) return
      const result = reduceNextQuestion(meta.state, {
        playerId: userId,
        now: Date.now(),
        roundMs: ROUND_MS,
      })
      meta.state = result.state
      applyEffects(io, roomId, result.effects, meta)
    })

    socket.on('syncRequest', () => {
      const roomId = socket.data.roomId
      if (!roomId) return
      const meta = rooms.get(roomId)
      if (!meta) return
      socket.emit('syncState', snapshot(meta.state, { now: Date.now() }))
    })

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId
      if (!roomId) return
      const meta = rooms.get(roomId)
      if (!meta) return
      // Only act if this socket is still the registered one for this user;
      // a single-session swap will have already replaced us.
      if (meta.sockets.get(userId) !== socket) return
      meta.sockets.delete(userId)

      const result = reduceLeave(meta.state, { playerId: userId })
      meta.state = result.state
      applyEffects(io, roomId, result.effects, meta)

      scheduleReaperIfEmpty(roomId, meta)
    })
  })
}

// Exposed for tests.
module.exports.__rooms = rooms
module.exports.__destroyRoom = destroyRoom
