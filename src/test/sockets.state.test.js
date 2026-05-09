const {
  PHASES,
  createRoom,
  reduceJoin,
  reduceLeave,
  reduceStartGame,
  reduceSubmit,
  reduceTimeout,
  reduceNextQuestion,
  buildScoreboard,
  pickWinner,
} = require('../sockets/state')

const ROUND_MS = 30_000
const QUESTIONS_COUNT = 3

function freshRoom(extra = {}) {
  return { ...createRoom({ questionsCount: QUESTIONS_COUNT, now: 1000 }), ...extra }
}

function broadcasts(effects) {
  return effects.filter((e) => e.type === 'broadcast')
}

describe('reduceJoin', () => {
  test('first joiner becomes admin and emits playerJoined + adminChanged', () => {
    const r = freshRoom()
    const { state, effects } = reduceJoin(r, {
      playerId: 'u1',
      nickName: 'Alice',
      img: '',
      now: 1100,
    })
    expect(state.adminId).toBe('u1')
    expect(state.players.u1.connected).toBe(true)
    const events = broadcasts(effects).map((e) => e.event)
    expect(events).toEqual(['playerJoined', 'adminChanged'])
  })

  test('second joiner does not become admin, only emits playerJoined', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    const { state, effects } = reduceJoin(r, {
      playerId: 'u2',
      nickName: 'B',
      img: '',
      now: 1200,
    })
    expect(state.adminId).toBe('u1')
    expect(Object.keys(state.players)).toEqual(['u1', 'u2'])
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['playerJoined'])
  })

  test('rejoin marks connected without duplicating', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceLeave(r, { playerId: 'u1' }).state
    expect(r.players.u1.connected).toBe(false)
    const { state, effects } = reduceJoin(r, {
      playerId: 'u1',
      nickName: 'A',
      img: '',
      now: 1300,
    })
    expect(state.players.u1.connected).toBe(true)
    expect(Object.keys(state.players)).toEqual(['u1'])
    // Should NOT re-emit adminChanged on rejoin (admin was nulled by leave but reduceJoin
    // does not auto-promote on rejoin — admin stays null until a fresh joinRoom from a
    // new player triggers the first-joiner branch).
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['playerJoined'])
  })
})

describe('reduceLeave', () => {
  test('admin leaving transfers to next-joined connected player', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    r = reduceJoin(r, { playerId: 'u3', nickName: 'C', img: '', now: 1300 }).state
    const { state, effects } = reduceLeave(r, { playerId: 'u1' })
    expect(state.adminId).toBe('u2')
    expect(state.players.u1.connected).toBe(false)
    const evts = broadcasts(effects).map((e) => e.event)
    expect(evts).toEqual(['playerLeft', 'adminChanged'])
  })

  test('no admin transfer when non-admin leaves', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    const { state, effects } = reduceLeave(r, { playerId: 'u2' })
    expect(state.adminId).toBe('u1')
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['playerLeft'])
  })

  test('admin leaving with no other connected players sets adminId to null', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    const { state, effects } = reduceLeave(r, { playerId: 'u1' })
    expect(state.adminId).toBeNull()
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['playerLeft'])
  })
})

describe('reduceStartGame', () => {
  function joined() {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    return r
  }

  test('admin starting from WAITING transitions to QUESTION and emits roundStart', () => {
    const r = joined()
    const { state, effects } = reduceStartGame(r, {
      playerId: 'u1',
      now: 2000,
      roundMs: ROUND_MS,
    })
    expect(state.phase).toBe(PHASES.QUESTION)
    expect(state.qIndex).toBe(0)
    expect(state.roundEndsAt).toBe(2000 + ROUND_MS)
    const types = effects.map((e) => e.type)
    expect(types).toContain('startTimer')
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['roundStart'])
  })

  test('non-admin startGame is silently ignored', () => {
    const r = joined()
    const { state, effects } = reduceStartGame(r, {
      playerId: 'u2',
      now: 2000,
      roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('startGame from non-WAITING phase is silently ignored', () => {
    let r = joined()
    r = reduceStartGame(r, { playerId: 'u1', now: 2000, roundMs: ROUND_MS }).state
    const { state, effects } = reduceStartGame(r, {
      playerId: 'u1',
      now: 2500,
      roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })
})

describe('reduceSubmit', () => {
  function inQuestion() {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    r = reduceStartGame(r, { playerId: 'u1', now: 2000, roundMs: ROUND_MS }).state
    return r
  }

  test('valid submission emits answerAdded with server-derived playerId', () => {
    const r = inQuestion()
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u1',
      qIndex: 0,
      score: 1,
      time: 4.2,
      now: 2500,
      roundMs: ROUND_MS,
    })
    const ans = state.answers[0].u1
    expect(ans.playerId).toBe('u1')
    expect(ans.score).toBe(1)
    expect(ans.time).toBe(4.2)
    expect(broadcasts(effects)[0].event).toBe('answerAdded')
  })

  test('clamps score to 0|1', () => {
    const r = inQuestion()
    const out = reduceSubmit(r, {
      playerId: 'u1',
      qIndex: 0,
      score: 9999,
      time: 1,
      now: 2500,
      roundMs: ROUND_MS,
    })
    expect(out.state.answers[0].u1.score).toBe(0)
  })

  test('clamps time to [0, ROUND_MS/1000]', () => {
    const r = inQuestion()
    const a = reduceSubmit(r, {
      playerId: 'u1', qIndex: 0, score: 1, time: -5, now: 2500, roundMs: ROUND_MS,
    })
    expect(a.state.answers[0].u1.time).toBe(0)

    const b = reduceSubmit(r, {
      playerId: 'u2', qIndex: 0, score: 1, time: 9999, now: 2500, roundMs: ROUND_MS,
    })
    expect(b.state.answers[0].u2.time).toBe(ROUND_MS / 1000)
  })

  test('rejects when phase !== QUESTION', () => {
    const r = freshRoom()
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u1', qIndex: 0, score: 1, time: 1, now: 2500, roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('rejects stale qIndex', () => {
    const r = inQuestion()
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u1', qIndex: 5, score: 1, time: 1, now: 2500, roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('idempotent on duplicate from same player', () => {
    let r = inQuestion()
    r = reduceSubmit(r, { playerId: 'u1', qIndex: 0, score: 1, time: 1, now: 2500, roundMs: ROUND_MS }).state
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u1', qIndex: 0, score: 1, time: 7, now: 2700, roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('rejects late submission past grace window', () => {
    const r = inQuestion()
    const lateNow = r.roundEndsAt + 1000
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u1', qIndex: 0, score: 1, time: 1, now: lateNow, roundMs: ROUND_MS, graceMs: 250,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('all-answered triggers early roundEnd', () => {
    let r = inQuestion()
    r = reduceSubmit(r, { playerId: 'u1', qIndex: 0, score: 1, time: 2, now: 2500, roundMs: ROUND_MS }).state
    const { state, effects } = reduceSubmit(r, {
      playerId: 'u2', qIndex: 0, score: 1, time: 5, now: 2700, roundMs: ROUND_MS,
    })
    expect(state.phase).toBe(PHASES.REVEAL)
    const events = broadcasts(effects).map((e) => e.event)
    expect(events).toEqual(['answerAdded', 'roundEnd'])
  })
})

describe('reduceTimeout / pickWinner', () => {
  // Three players so partial answers don't trigger the all-answered early-end.
  function inQuestionWithAnswers(answers) {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    r = reduceJoin(r, { playerId: 'u3', nickName: 'C', img: '', now: 1300 }).state
    r = reduceStartGame(r, { playerId: 'u1', now: 2000, roundMs: ROUND_MS }).state
    for (const a of answers) {
      r = reduceSubmit(r, { ...a, now: 2500, roundMs: ROUND_MS }).state
    }
    return r
  }

  test('idempotent: timeout from REVEAL is a no-op', () => {
    const r = inQuestionWithAnswers([
      { playerId: 'u1', qIndex: 0, score: 1, time: 2 },
    ])
    const after = reduceTimeout(r)
    const idem = reduceTimeout(after.state)
    expect(idem.state).toEqual(after.state)
    expect(idem.effects).toEqual([])
  })

  test('picks winner with lowest time among correct answers', () => {
    const r = inQuestionWithAnswers([
      { playerId: 'u1', qIndex: 0, score: 1, time: 5 },
      { playerId: 'u2', qIndex: 0, score: 1, time: 3 },
    ])
    const { state, effects } = reduceTimeout(r)
    expect(state.phase).toBe(PHASES.REVEAL)
    expect(state.answers[0].u2.isVinner).toBe(true)
    expect(state.answers[0].u1.isVinner).toBe(false)
    const re = broadcasts(effects).find((e) => e.event === 'roundEnd')
    expect(re.payload.winnerAnswerId).toBe('u2-0')
  })

  test('no correct answers yields null winner', () => {
    const r = inQuestionWithAnswers([
      { playerId: 'u1', qIndex: 0, score: 0, time: 5 },
      { playerId: 'u2', qIndex: 0, score: 0, time: 3 },
    ])
    const { state, effects } = reduceTimeout(r)
    expect(state.phase).toBe(PHASES.REVEAL)
    const re = broadcasts(effects).find((e) => e.event === 'roundEnd')
    expect(re.payload.winnerAnswerId).toBeNull()
  })
})

describe('reduceNextQuestion', () => {
  function inReveal() {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    r = reduceStartGame(r, { playerId: 'u1', now: 2000, roundMs: ROUND_MS }).state
    r = reduceSubmit(r, { playerId: 'u1', qIndex: 0, score: 1, time: 1, now: 2500, roundMs: ROUND_MS }).state
    r = reduceTimeout(r).state
    return r
  }

  test('admin advances from REVEAL → QUESTION', () => {
    const r = inReveal()
    const { state, effects } = reduceNextQuestion(r, {
      playerId: 'u1',
      now: 5000,
      roundMs: ROUND_MS,
    })
    expect(state.phase).toBe(PHASES.QUESTION)
    expect(state.qIndex).toBe(1)
    expect(broadcasts(effects).map((e) => e.event)).toEqual(['roundStart'])
  })

  test('non-admin nextQuestion is ignored', () => {
    const r = inReveal()
    const { state, effects } = reduceNextQuestion(r, {
      playerId: 'u2',
      now: 5000,
      roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('nextQuestion from non-REVEAL phase is ignored', () => {
    let r = freshRoom()
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    const { state, effects } = reduceNextQuestion(r, {
      playerId: 'u1', now: 5000, roundMs: ROUND_MS,
    })
    expect(state).toEqual(r)
    expect(effects).toEqual([])
  })

  test('past last question transitions to FINAL with gameOver scoreboard', () => {
    let r = freshRoom() // QUESTIONS_COUNT = 3
    r = reduceJoin(r, { playerId: 'u1', nickName: 'A', img: '', now: 1100 }).state
    r = reduceJoin(r, { playerId: 'u2', nickName: 'B', img: '', now: 1200 }).state
    r = reduceStartGame(r, { playerId: 'u1', now: 2000, roundMs: ROUND_MS }).state
    // Q0
    r = reduceSubmit(r, { playerId: 'u1', qIndex: 0, score: 1, time: 1, now: 2500, roundMs: ROUND_MS }).state
    r = reduceTimeout(r).state
    r = reduceNextQuestion(r, { playerId: 'u1', now: 3000, roundMs: ROUND_MS }).state
    // Q1
    r = reduceSubmit(r, { playerId: 'u2', qIndex: 1, score: 1, time: 2, now: 3500, roundMs: ROUND_MS }).state
    r = reduceTimeout(r).state
    r = reduceNextQuestion(r, { playerId: 'u1', now: 4000, roundMs: ROUND_MS }).state
    // Q2
    r = reduceSubmit(r, { playerId: 'u1', qIndex: 2, score: 1, time: 3, now: 4500, roundMs: ROUND_MS }).state
    r = reduceTimeout(r).state
    const final = reduceNextQuestion(r, { playerId: 'u1', now: 5000, roundMs: ROUND_MS })

    expect(final.state.phase).toBe(PHASES.FINAL)
    const go = broadcasts(final.effects).find((e) => e.event === 'gameOver')
    expect(go).toBeDefined()
    expect(Array.isArray(go.payload.scoreboard)).toBe(true)
    expect(go.payload.scoreboard.length).toBe(2)
  })
})

describe('buildScoreboard', () => {
  test('sorts by totalScore desc, totalTime asc, victories desc', () => {
    const state = {
      answers: {
        0: {
          u1: { playerId: 'u1', nickName: 'A', img: '', score: 1, time: 5, isVinner: false },
          u2: { playerId: 'u2', nickName: 'B', img: '', score: 1, time: 3, isVinner: true },
          u3: { playerId: 'u3', nickName: 'C', img: '', score: 0, time: 30, isVinner: false },
        },
        1: {
          u1: { playerId: 'u1', nickName: 'A', img: '', score: 1, time: 4, isVinner: true },
          u2: { playerId: 'u2', nickName: 'B', img: '', score: 0, time: 10, isVinner: false },
          u3: { playerId: 'u3', nickName: 'C', img: '', score: 1, time: 6, isVinner: false },
        },
      },
    }
    const sb = buildScoreboard(state)
    // u1 and u2 both have totalScore=2 vs u3 totalScore=1.
    // u1: time 9, victories 1; u2: time 13, victories 1.
    // u1 < u2 by totalTime, then u3 last.
    expect(sb.map((r) => r.playerId)).toEqual(['u1', 'u2', 'u3'])
    expect(sb[0].totalScore).toBe(2)
    expect(sb[0].totalTime).toBe(9)
    expect(sb[0].victories).toBe(1)
  })
})

describe('pickWinner', () => {
  test('returns null when no correct answers', () => {
    expect(
      pickWinner({
        u1: { playerId: 'u1', score: 0, time: 1, answerId: 'a' },
      })
    ).toBeNull()
  })

  test('picks lowest time among score===1', () => {
    const w = pickWinner({
      u1: { playerId: 'u1', score: 1, time: 5, answerId: 'u1-0' },
      u2: { playerId: 'u2', score: 1, time: 2, answerId: 'u2-0' },
      u3: { playerId: 'u3', score: 0, time: 1, answerId: 'u3-0' },
    })
    expect(w.playerId).toBe('u2')
  })
})
