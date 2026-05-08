const express = require('express')
const request = require('supertest')
const { SignJWT } = require('jose')

// Helper to create HS256 token with shared secret
async function makeToken(payload = {}, secret = 'test_jwt_secret') {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret))
}

describe('End-to-end auth and protected routes', () => {
  const ORIGINAL_ENV = process.env

  afterEach(() => {
    jest.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  test('GET /users requires auth and returns users with valid token', async () => {
    process.env.JWT_SECRET = 'test_jwt_secret'

    const users = [{ id: 1, email: 'a@b.com' }]
    const { makeSupabaseMock } = require('./utils/mockSupabase')
    const mockSupabase = makeSupabaseMock({ selectResult: { data: users, error: null } })

    jest.doMock('../db/supabase', () => mockSupabase)
    const { app } = require('../../server')

    const token = await makeToken({ email: 'a@b.com' }, process.env.JWT_SECRET)

    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.users).toEqual(users)
  })

  test('GET /users returns 401 without token', async () => {
    process.env.JWT_SECRET = 'test_jwt_secret'
    const { makeSupabaseMock } = require('./utils/mockSupabase')
    const mockSupabase = makeSupabaseMock({ selectResult: { data: [], error: null } })
    jest.doMock('../db/supabase', () => mockSupabase)
    const { app } = require('../../server')

    const res = await request(app).get('/users')
    expect(res.status).toBe(401)
  })

  test('POST /trivia/createRoom requires auth and creates room', async () => {
    process.env.JWT_SECRET = 'test_jwt_secret'

    const newRoom = { id: 5, name: 'funtime' }
    const { makeSupabaseMock } = require('./utils/mockSupabase')
    const mockSupabase = makeSupabaseMock({ insertResult: { data: newRoom, error: null } })
    jest.doMock('../db/supabase', () => mockSupabase)
    const { app } = require('../../server')
    const token = await makeToken({ email: 'a@b.com' }, process.env.JWT_SECRET)

    const res = await request(app)
      .post('/trivia/createRoom')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'funtime' })

    expect(res.status).toBe(200)
    expect(res.body.newRoom).toEqual(newRoom)
  })

  test('PUT /trivia/addPlayer requires auth and updates participants', async () => {
    process.env.JWT_SECRET = 'test_jwt_secret'

    const roomId = 42
    const existing = { participants: [] }
    const updated = { id: roomId, participants: [{ name: 'p' }] }

    const { makeSupabaseMock } = require('./utils/mockSupabase')
    const mockSupabase = makeSupabaseMock({ tables: { rooms: { selectResult: { data: existing, error: null }, updateResult: { data: updated, error: null } } } })
    jest.doMock('../db/supabase', () => mockSupabase)
    const { app } = require('../../server')
    const token = await makeToken({ email: 'a@b.com' }, process.env.JWT_SECRET)

    const payload = { roomId, player: { name: 'p', nickName: 'np', img: '', isAdmin: false } }
    const res = await request(app)
      .put('/trivia/addPlayer')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.updateResult).toEqual(updated)
  })

  test('PUT /users/progress returns 404 when user not found and 201 when updated', async () => {
    // user not found case
    const { makeSupabaseMock } = require('./utils/mockSupabase')
    const mockNotFound = makeSupabaseMock({ selectResult: { data: [], error: null } })
    jest.doMock('../db/supabase', () => mockNotFound)
    let usersRouter = require('../routes/users')
    let app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    let res = await request(app).put('/users/progress').send({ email: 'no@one.com' })
    expect(res.status).toBe(404)

    // found + update case
    const userRec = [{ id: 9, email: 'yes@one.com' }]
    const mockUpdate = makeSupabaseMock({ selectResult: { data: userRec, error: null }, updateResult: { data: userRec, error: null } })

    jest.resetModules()
    jest.doMock('../db/supabase', () => mockUpdate)
    usersRouter = require('../routes/users')
    app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    res = await request(app).put('/users/progress').send({ email: 'yes@one.com', articel: 'early History', scrollProcentage: 50 })
    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
  })
})
