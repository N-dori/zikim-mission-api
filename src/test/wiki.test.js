const request = require('supertest')
// Ensure tests that import the app don't fail requiring supabase when CI has no secrets
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test'
const { app } = require('../../server')

describe('POST /wiki', () => {
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  test('returns 400 when txt is missing', async () => {
    const res = await request(app).post('/wiki').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('message', 'txt required')
  })

  test('proxies wikipedia extract', async () => {
    const fakeResponse = { query: { pages: { '123': { extract: 'hello' } } } }
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue(fakeResponse)
    })

    const res = await request(app).post('/wiki').send({ txt: 'ישראל' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.data).toEqual(fakeResponse)
    expect(global.fetch).toHaveBeenCalled()
  })
})

describe('POST /wiki/link', () => {
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  test('returns 400 when txt is missing', async () => {
    const res = await request(app).post('/wiki/link').send({})
    expect(res.status).toBe(400)
  })

  test('proxies opensearch', async () => {
    const fake = ['term', ['suggestion']]
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue(fake)
    })

    const res = await request(app).post('/wiki/link').send({ txt: 'תל אביב' })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(fake)
    expect(global.fetch).toHaveBeenCalled()
  })
})