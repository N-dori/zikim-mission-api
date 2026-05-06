const { verifyJwt } = require('../middleware/auth')

// Optional: when AUTH_SOCKET=false (e.g. early local dev), the handshake check
// is skipped so you can iterate on the frontend without wiring tokens.
const AUTH_REQUIRED = process.env.AUTH_SOCKET !== 'false'

module.exports = function registerSocketHandlers(io) {
  if (AUTH_REQUIRED) {
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth && socket.handshake.auth.token
        if (!token) return next(new Error('No auth token'))
        socket.data.user = await verifyJwt(token)
        next()
      } catch (err) {
        next(new Error('Bad auth token'))
      }
    })
  }

  io.on('connection', (socket) => {
    console.log(`Socket ${socket.id} connected${socket.data.user ? ` as ${socket.data.user.email}` : ''}.`)

    socket.on('joinRoom', ({ roomId } = {}) => {
      if (!roomId) return
      if (socket.data.roomId && socket.data.roomId !== roomId) {
        socket.leave(socket.data.roomId)
      }
      socket.data.roomId = roomId
      socket.join(roomId)
      console.log(`Socket ${socket.id} joined room ${roomId}`)
    })

    const roomOf = (payloadRoomId) => payloadRoomId || socket.data.roomId

    socket.on('playerAdded', ({ player, roomId } = {}) => {
      const room = roomOf(roomId)
      if (!room) return
      console.log(`Player added in room ${room}:`, player)
      io.to(room).emit('playerAdded', { player })
    })

    socket.on('allHere', ({ roomId } = {}) => {
      const room = roomOf(roomId)
      if (!room) return
      console.log(`All here event received for room ${room}`)
      io.to(room).emit('allHere')
    })

    socket.on('addPlayerScore', (newScore) => {
      const room = roomOf(newScore && newScore.roomId)
      if (!room) return
      console.log(`adding score of player in room ${room}:`, newScore)
      io.to(room).emit('addPlayerScore', newScore)
    })

    socket.on('next question', (payload = {}) => {
      const room = roomOf(payload && payload.roomId)
      if (!room) return
      console.log(`next question in room ${room}`)
      io.to(room).emit('next question')
    })

    socket.on('setFinalResultes', (newScoreSummery) => {
      const room = roomOf(newScoreSummery && newScoreSummery.roomId)
      if (!room) return
      console.log(`final score results in room ${room}:`, newScoreSummery)
      io.to(room).emit('setFinalResultes', newScoreSummery)
    })

    socket.on('disconnect', (reason) => {
      console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`)
    })

    socket.on('error', (error) => {
      console.error(`Socket error: ${error}`)
    })
  })
}
