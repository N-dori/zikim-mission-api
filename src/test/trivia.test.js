const express = require('express')
const request = require('supertest')

const { makeSupabaseMock } = require('./utils/mockSupabase')

describe('trivia routes', () => {
  afterEach(() => { jest.resetModules() })

  test('POST /trivia/getRoom returns 400 when name missing', async () => {
    const mock = makeSupabaseMock({ data: [], error: null })
    jest.doMock('../db/supabase', () => mock)
    const triviaRouter = require('../routes/trivia')
    const app = express()
    app.use(express.json())
    app.use('/trivia', triviaRouter)

    const res = await request(app).post('/trivia/getRoom').send({})
    expect(res.status).toBe(400)
  })

  test('POST /trivia/getRoom returns room when found', async () => {
    const room = { id: 1, name: 'room1' }
    const mock = makeSupabaseMock({ data: [room], error: null })
    jest.doMock('../db/supabase', () => mock)
    const triviaRouter = require('../routes/trivia')
    const app = express()
    app.use(express.json())
    app.use('/trivia', triviaRouter)

    const res = await request(app).post('/trivia/getRoom').send({ name: 'room1' })
    expect(res.status).toBe(201)
    expect(res.body.room).toEqual(room)
  })

  test('POST /trivia/getParticipants returns 400 when id missing', async () => {
    const mock = makeSupabaseMock({ data: [], error: null })
    jest.doMock('../db/supabase', () => mock)
    const triviaRouter = require('../routes/trivia')
    const app = express()
    app.use(express.json())
    app.use('/trivia', triviaRouter)

    const res = await request(app).post('/trivia/getParticipants').send({})
    expect(res.status).toBe(400)
  })
})
