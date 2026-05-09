// Pure state machine for a trivia room.
//
// All reducers take (state, action, ctx) and return { state, effects[] }.
// Effects are descriptors the I/O layer applies (broadcast / startTimer /
// clearTimer). Reducers never touch sockets, timers, or globals.

const PHASES = Object.freeze({
  WAITING: 'WAITING',
  QUESTION: 'QUESTION',
  REVEAL: 'REVEAL',
  FINAL: 'FINAL',
})

function createRoom({ questionsCount, now = Date.now() }) {
  return {
    adminId: null,
    phase: PHASES.WAITING,
    qIndex: 0,
    roundStartedAt: 0,
    roundEndsAt: 0,
    answers: {},
    players: {},
    questionsCount,
    createdAt: now,
  }
}

function pickWinner(bucket) {
  const correct = Object.values(bucket).filter((a) => a.score > 0)
  if (!correct.length) return null
  correct.sort((a, b) => a.time - b.time)
  return correct[0]
}

function buildScoreboard(state) {
  const totals = {}
  for (const bucket of Object.values(state.answers)) {
    for (const a of Object.values(bucket)) {
      const t = totals[a.playerId] || {
        playerId: a.playerId,
        nickName: a.nickName,
        img: a.img,
        totalScore: 0,
        totalTime: 0,
        victories: 0,
      }
      t.totalScore += a.score
      t.totalTime += a.time
      if (a.isVinner) t.victories += 1
      totals[a.playerId] = t
    }
  }
  return Object.values(totals).sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      a.totalTime - b.totalTime ||
      b.victories - a.victories
  )
}

function snapshot(state, { now }) {
  return {
    phase: state.phase,
    qIndex: state.qIndex,
    roundStartedAt: state.roundStartedAt,
    roundEndsAt: state.roundEndsAt,
    serverNow: now,
    adminId: state.adminId,
    players: Object.values(state.players).map((p) => ({
      playerId: p.playerId,
      nickName: p.nickName,
      img: p.img,
      connected: p.connected,
    })),
    answers: Object.values(state.answers).flatMap((bucket) =>
      Object.values(bucket)
    ),
  }
}

function reduceJoin(state, { playerId, nickName, img, now }) {
  const existing = state.players[playerId]
  if (existing) {
    const next = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...existing,
          nickName,
          img,
          connected: true,
        },
      },
    }
    return {
      state: next,
      effects: [
        {
          type: 'broadcast',
          event: 'playerJoined',
          payload: { playerId, nickName, img },
        },
      ],
    }
  }

  const newAdmin = state.adminId == null
  const adminId = newAdmin ? playerId : state.adminId
  const next = {
    ...state,
    adminId,
    players: {
      ...state.players,
      [playerId]: {
        playerId,
        nickName,
        img,
        connected: true,
        joinedAt: now,
      },
    },
  }
  const effects = [
    {
      type: 'broadcast',
      event: 'playerJoined',
      payload: { playerId, nickName, img },
    },
  ]
  if (newAdmin) {
    effects.push({
      type: 'broadcast',
      event: 'adminChanged',
      payload: { adminId },
    })
  }
  return { state: next, effects }
}

function reduceLeave(state, { playerId }) {
  const existing = state.players[playerId]
  if (!existing) return { state, effects: [] }

  const next = {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...existing, connected: false },
    },
  }
  const effects = [
    { type: 'broadcast', event: 'playerLeft', payload: { playerId } },
  ]

  if (state.adminId === playerId) {
    const candidates = Object.values(next.players)
      .filter((p) => p.connected && p.playerId !== playerId)
      .sort((a, b) => a.joinedAt - b.joinedAt)
    const nextAdmin = candidates[0]
    next.adminId = nextAdmin ? nextAdmin.playerId : null
    if (next.adminId) {
      effects.push({
        type: 'broadcast',
        event: 'adminChanged',
        payload: { adminId: next.adminId },
      })
    }
  }

  return { state: next, effects }
}

function startRound(state, { now, roundMs }) {
  if (state.qIndex >= state.questionsCount) {
    const finished = { ...state, phase: PHASES.FINAL }
    return {
      state: finished,
      effects: [
        { type: 'clearTimer' },
        {
          type: 'broadcast',
          event: 'gameOver',
          payload: { scoreboard: buildScoreboard(finished) },
        },
      ],
    }
  }
  const next = {
    ...state,
    phase: PHASES.QUESTION,
    roundStartedAt: now,
    roundEndsAt: now + roundMs,
    answers: { ...state.answers, [state.qIndex]: {} },
  }
  return {
    state: next,
    effects: [
      { type: 'clearTimer' },
      { type: 'startTimer', ms: roundMs },
      {
        type: 'broadcast',
        event: 'roundStart',
        payload: {
          qIndex: next.qIndex,
          startedAt: next.roundStartedAt,
          endsAt: next.roundEndsAt,
          serverNow: now,
        },
      },
    ],
  }
}

function reduceStartGame(state, { playerId, now, roundMs }) {
  if (state.adminId !== playerId) return { state, effects: [] }
  if (state.phase !== PHASES.WAITING) return { state, effects: [] }
  return startRound({ ...state, qIndex: 0 }, { now, roundMs })
}

function endRound(state) {
  if (state.phase !== PHASES.QUESTION) return { state, effects: [] }
  const bucket = state.answers[state.qIndex] || {}
  const winner = pickWinner(bucket)
  let nextBucket = bucket
  if (winner) {
    nextBucket = {
      ...bucket,
      [winner.playerId]: { ...winner, isVinner: true },
    }
  }
  const next = {
    ...state,
    phase: PHASES.REVEAL,
    answers: { ...state.answers, [state.qIndex]: nextBucket },
  }
  return {
    state: next,
    effects: [
      { type: 'clearTimer' },
      {
        type: 'broadcast',
        event: 'roundEnd',
        payload: {
          qIndex: state.qIndex,
          winnerAnswerId: winner ? winner.answerId : null,
          answers: Object.values(nextBucket),
        },
      },
    ],
  }
}

function reduceTimeout(state) {
  return endRound(state)
}

function reduceSubmit(
  state,
  { playerId, qIndex, score, time, optionId, now, roundMs, graceMs = 250 }
) {
  if (state.phase !== PHASES.QUESTION) return { state, effects: [] }
  if (qIndex !== state.qIndex) return { state, effects: [] }
  if (now > state.roundEndsAt + graceMs) return { state, effects: [] }
  const player = state.players[playerId]
  if (!player) return { state, effects: [] }
  const bucket = state.answers[state.qIndex] || {}
  if (bucket[playerId]) return { state, effects: [] } // idempotent

  const clampedScore = score === 1 ? 1 : 0
  const maxTime = roundMs / 1000
  const clampedTime = Math.max(0, Math.min(maxTime, Number(time) || 0))

  const ans = {
    answerId: `${playerId}-${state.qIndex}`,
    playerId,
    questionId: state.qIndex,
    nickName: player.nickName,
    img: player.img,
    score: clampedScore,
    time: clampedTime,
    isVinner: false,
    optionId: optionId != null ? String(optionId) : undefined,
  }

  const nextBucket = { ...bucket, [playerId]: ans }
  const nextState = {
    ...state,
    answers: { ...state.answers, [state.qIndex]: nextBucket },
  }
  const effects = [
    { type: 'broadcast', event: 'answerAdded', payload: ans },
  ]

  // Early-end the round if every connected player has answered.
  const connected = Object.values(nextState.players).filter((p) => p.connected)
  if (connected.length > 0 && connected.every((p) => nextBucket[p.playerId])) {
    const ended = endRound(nextState)
    return { state: ended.state, effects: [...effects, ...ended.effects] }
  }

  return { state: nextState, effects }
}

function reduceNextQuestion(state, { playerId, now, roundMs }) {
  if (state.adminId !== playerId) return { state, effects: [] }
  if (state.phase !== PHASES.REVEAL) return { state, effects: [] }
  return startRound(
    { ...state, qIndex: state.qIndex + 1 },
    { now, roundMs }
  )
}

module.exports = {
  PHASES,
  createRoom,
  reduceJoin,
  reduceLeave,
  reduceStartGame,
  reduceSubmit,
  reduceTimeout,
  reduceNextQuestion,
  startRound,
  endRound,
  pickWinner,
  buildScoreboard,
  snapshot,
}
