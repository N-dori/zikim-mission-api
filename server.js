require('dotenv').config()

const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const cors = require('cors')

const usersRouter = require('./src/routes/users')
const triviaRouter = require('./src/routes/trivia')
const wikiRouter = require('./src/routes/wiki')
const registerSocketHandlers = require('./src/sockets')
const errorHandler = require('./src/middleware/error')

const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsConfig = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}

const app = express()
app.use(cors(corsConfig))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

app.use('/users', usersRouter)
app.use('/trivia', triviaRouter)
app.use('/wiki', wikiRouter)

app.use(errorHandler)

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
})

registerSocketHandlers(io)

const port = Number(process.env.PORT) || 4000
httpServer.listen(port, () => {
  console.log(`> API listening on http://localhost:${port}`)
  console.log(`> CORS allowed origins: ${allowedOrigins.join(', ')}`)
})

module.exports = { app, io, httpServer }
