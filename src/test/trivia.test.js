const express = require('express')
const request = require('supertest')
const { SignJWT } = require('jose')

const { makeSupabaseMock } = require('./utils/mockSupabase')

async function makeToken(payload = {}, secret = 'test_jwt_secret') {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret))
}

describe('trivia routes', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env.JWT_SECRET = 'test_jwt_secret'
  })

  afterEach(() => {
    jest.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  async function buildApp(mock) {
    jest.doMock('../db/supabase', () => mock)
    const triviaRouter = require('../routes/trivia')
    const app = express()
    app.use(express.json())
    app.use('/trivia', triviaRouter)
    return app
  }

  test('POST /trivia/getRoom returns 401 without auth', async () => {
    const app = await buildApp(makeSupabaseMock({ data: [], error: null }))
    const res = await request(app).post('/trivia/getRoom').send({ name: 'room1' })
    expect(res.status).toBe(401)
  })

  test('POST /trivia/getRoom returns 400 when name missing', async () => {
    const app = await buildApp(makeSupabaseMock({ data: [], error: null }))
    const token = await makeToken({ id: 'u1', email: 'a@b.com' })
    const res = await request(app)
      .post('/trivia/getRoom')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  test('POST /trivia/getRoom returns 200 + room when found', async () => {
    const room = { id: 1, name: 'room1' }
    const app = await buildApp(makeSupabaseMock({ data: [room], error: null }))
    const token = await makeToken({ id: 'u1', email: 'a@b.com' })
    const res = await request(app)
      .post('/trivia/getRoom')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'room1' })
    expect(res.status).toBe(200)
    expect(res.body.room).toEqual(room)
  })

  test('POST /trivia/getParticipants returns 401 without auth', async () => {
    const app = await buildApp(makeSupabaseMock({ data: [], error: null }))
    const res = await request(app).post('/trivia/getParticipants').send({ id: 1 })
    expect(res.status).toBe(401)
  })

  test('POST /trivia/getParticipants returns 400 when id missing', async () => {
    const app = await buildApp(makeSupabaseMock({ data: [], error: null }))
    const token = await makeToken({ id: 'u1', email: 'a@b.com' })
    const res = await request(app)
      .post('/trivia/getParticipants')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  test('GET /trivia/questions requires auth and returns deck', async () => {
    const app = await buildApp(makeSupabaseMock({ data: [], error: null }))

    const unauth = await request(app).get('/trivia/questions')
    expect(unauth.status).toBe(401)

    const token = await makeToken({ id: 'u1', email: 'a@b.com' })
    const res = await request(app).get('/trivia/questions').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.questions)).toBe(true)
    expect(res.body.questions.length).toBeGreaterThan(0)
    expect(typeof res.body.version).toBe('string')
    expect(res.body.count).toBe(res.body.questions.length)
  })

  test('PUT /trivia/addPlayer ignores client-supplied isAdmin', async () => {
    const existing = { participants: [] }
    const updated = { id: 42, participants: [{ name: 'p', nickName: 'np', img: '', answers: [] }] }
    const mock = makeSupabaseMock({
      tables: {
        rooms: {
          selectResult: { data: existing, error: null },
          updateResult: { data: updated, error: null },
        },
      },
    })
    const app = await buildApp(mock)
    const token = await makeToken({ id: 'u1', email: 'a@b.com' })

    const res = await request(app)
      .put('/trivia/addPlayer')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId: 42, player: { name: 'p', nickName: 'np', img: '', isAdmin: true } })

    expect(res.status).toBe(200)
    // Server stripped isAdmin from the persisted payload.
    const persisted = mock.captured.updateArgs.participants[0]
    expect(persisted).not.toHaveProperty('isAdmin')
  })
})
