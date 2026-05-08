const express = require('express')
const request = require('supertest')
const bcrypt = require('bcryptjs')

const { makeSupabaseMock } = require('./utils/mockSupabase')

describe('users routes (expanded)', () => {
  afterEach(() => { jest.resetModules() })

  test('POST /users/exists returns 400 when email missing', async () => {
    const mock = makeSupabaseMock()
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/exists').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('message', 'email required')
  })

  test('POST /users/exists returns user when found', async () => {
    const user = { id: 1, email: 'a@b.com', name: 'Test' }
    const mock = makeSupabaseMock({ selectResult: { data: [user], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/exists').send({ email: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(res.body.exists).toBe(true)
  })

  test('POST /users/exists returns user:null when not found', async () => {
    const mock = makeSupabaseMock({ selectResult: { data: [], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/exists').send({ email: 'not@found.com' })
    expect(res.status).toBe(200)
    expect(res.body.exists).toBe(false)
  })

  test('POST /users/exists returns 500 on db error', async () => {
    const mock = makeSupabaseMock({ selectResult: { data: [], error: new Error('boom') } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/exists').send({ email: 'err@db.com' })
    expect(res.status).toBe(500)
  })

  test('POST /users/login returns 200 on valid creds', async () => {
    const plain = 'secret123'
    const hashed = await bcrypt.hash(plain, 10)
    const user = { id: 1, email: 'a@b.com', name: 'Test', password: hashed }
    const mock = makeSupabaseMock({ selectResult: { data: [user], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/login').send({ email: 'a@b.com', password: plain })
    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
    expect(res.body.user).not.toHaveProperty('password')
  })

  test('POST /users/login 400 missing password', async () => {
    const mock = makeSupabaseMock()
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/login').send({ email: 'a@b.com' })
    expect(res.status).toBe(400)
  })

  test('POST /users/login 401 user not found', async () => {
    const mock = makeSupabaseMock({ selectResult: { data: [], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/login').send({ email: 'no@one.com', password: 'x' })
    expect(res.status).toBe(401)
  })

  test('POST /users/login 401 wrong password', async () => {
    const hashed = await bcrypt.hash('right', 10)
    const user = { id: 1, email: 'a@b.com', name: 'Test', password: hashed }
    const mock = makeSupabaseMock({ selectResult: { data: [user], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/login').send({ email: 'a@b.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  test('POST /users/login 500 on db error', async () => {
    const mock = makeSupabaseMock({ selectResult: { data: [], error: new Error('db') } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).post('/users/login').send({ email: 'a@b.com', password: 'x' })
    expect(res.status).toBe(500)
  })

  describe('POST /users/register validations and behavior', () => {
    afterEach(() => { jest.resetModules() })

    it.each([
      [{ email: 'a@b.com', password: 'x' }, 'missing name'],
      [{ name: 'n', password: 'x' }, 'missing email'],
      [{ name: 'n', email: 'a@b.com' }, 'missing password'],
    ])('returns 400 when required field missing (%s)', async (body) => {
      const mock = makeSupabaseMock()
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).post('/users/register').send(body)
      expect(res.status).toBe(400)
    })

    test('hashes password before insert and inserts user', async () => {
      const plain = 'mypw'
      const returned = { id: 2, email: 'a@b.com' }
      const mock = makeSupabaseMock({ insertResult: { data: [returned], error: null } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).post('/users/register').send({ name: 'n', email: 'a@b.com', password: plain })
      expect(res.status).toBe(201)
      // inspect captured insert args to verify password hashed
      const inserted = mock.captured.insertArgs && mock.captured.insertArgs[0]
      expect(inserted).toBeDefined()
      const match = await bcrypt.compare(plain, inserted.password)
      expect(match).toBe(true)
    })

    test('register allows missing battalion', async () => {
      const plain = 'mypw'
      const returned = { id: 3, email: 'b@c.com' }
      const mock = makeSupabaseMock({ insertResult: { data: [returned], error: null } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).post('/users/register').send({ name: 'n', email: 'b@c.com', password: plain })
      expect(res.status).toBe(201)
    })

    test('register returns 500 on db error', async () => {
      const mock = makeSupabaseMock({ insertResult: { data: [], error: new Error('db') } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).post('/users/register').send({ name: 'n', email: 'b@c.com', password: 'x' })
      expect(res.status).toBe(500)
    })
  })

  test('GET /users returns 401 without Bearer token', async () => {
    const mock = makeSupabaseMock({ selectResult: { data: [], error: null } })
    jest.doMock('../db/supabase', () => mock)
    const usersRouter = require('../routes/users')
    const app = express()
    app.use(express.json())
    app.use('/users', usersRouter)

    const res = await request(app).get('/users')
    expect(res.status).toBe(401)
  })

  describe('PUT /users/progress', () => {
    afterEach(() => { jest.resetModules() })

    test('400 when email missing', async () => {
      const mock = makeSupabaseMock()
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).put('/users/progress').send({})
      expect(res.status).toBe(400)
    })

    test('404 when user not found', async () => {
      const mock = makeSupabaseMock({ selectResult: { data: [], error: null } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).put('/users/progress').send({ email: 'no@one.com' })
      expect(res.status).toBe(404)
    })

    test('routes early History to is_early_history_completed', async () => {
      const user = { id: 9, email: 'u@u.com' }
      const mock = makeSupabaseMock({ selectResult: { data: [user], error: null }, updateResult: { data: [user], error: null } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).put('/users/progress').send({ email: 'u@u.com', articel: 'early History', scrollProcentage: 77 })
      expect(res.status).toBe(200)
      // assert the update payload targeted early history field
      expect(mock.captured.updateArgs).toBeDefined()
      expect(Object.prototype.hasOwnProperty.call(mock.captured.updateArgs, 'is_early_history_completed')).toBe(true)
    })

    test('routes other article to is_otef_aza_completed', async () => {
      const user = { id: 10, email: 'v@v.com' }
      const mock = makeSupabaseMock({ selectResult: { data: [user], error: null }, updateResult: { data: [user], error: null } })
      jest.doMock('../db/supabase', () => mock)
      const usersRouter = require('../routes/users')
      const app = express()
      app.use(express.json())
      app.use('/users', usersRouter)

      const res = await request(app).put('/users/progress').send({ email: 'v@v.com', articel: 'something else', scrollProcentage: 33 })
      expect(res.status).toBe(200)
      expect(mock.captured.updateArgs).toBeDefined()
      expect(Object.prototype.hasOwnProperty.call(mock.captured.updateArgs, 'is_otef_aza_completed')).toBe(true)
    })
  })
})
