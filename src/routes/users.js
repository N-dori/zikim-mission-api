const express = require('express')
const bcrypt = require('bcryptjs')
const supabase = require('../db/supabase')
const { requireAuth, signJwt } = require('../middleware/auth')
const rateLimit = require('express-rate-limit')

// Basic auth rate limiter: 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, try again later' }
})

function isValidEmail(email) {
  if (typeof email !== 'string') return false
  // simple but stricter RFC-like sanity check: something@something.tld
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 1
}

const router = express.Router()

// POST /users/exists  -> { user }
// Used by login + signup to check whether an email is registered.
router.post('/exists', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) return res.status(400).json({ message: 'email required' })
    if (!isValidEmail(email)) return res.status(400).json({ message: 'invalid email' })
    const { data, error } = await supabase.from('users').select('id').eq('email', email).limit(1)
    if (error) throw error
    const exists = !!(data && data.length)
    return res.status(200).json({ exists })
  } catch (err) {
    console.log('had a problem finding user', err)
    return res.status(500).json({ message: 'User lookup failed' })
  }
})

// POST /users/login  -> { user } (without password hash) | 401
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ message: 'email and password required' })
    if (!isValidEmail(email) || !isValidPassword(password)) return res.status(400).json({ message: 'invalid credentials' })
    const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1)
    if (error) throw error
    const user = data && data.length ? data[0] : null
    if (!user) return res.status(401).json({ message: 'invalid credentials' })
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ message: 'invalid credentials' })
    const { password: _pw, ...safeUser } = user
    // mint a short-lived JWT for API auth
    let token = null
    try {
      if (process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET) {
        token = await signJwt({ id: safeUser.id, email: safeUser.email })
      }
    } catch (e) {
      console.error('failed to sign jwt', e)
    }
    return res.status(200).json({ user: safeUser, token })
  } catch (err) {
    console.log('login failed', err)
    return res.status(500).json({ message: 'Login failed' })
  }
})

// POST /users/register  -> { message, user }
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, battalion, password } = req.body || {}
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'missing required fields' })
    }
    if (!isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({ message: 'invalid email or password' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, battalion, password: hashedPassword }])
      .select()
      .single()
    if (error) {
      // unique constraint / duplicate email
      if (error.code === '23505' || (error.message && /duplicate|unique/i.test(error.message))) {
        return res.status(409).json({ message: 'email already in use' })
      }
      throw error
    }
    const created = data
    const { password: _pw, ...safeUser } = Array.isArray(created) ? created[0] : created
    return res.status(201).json({ message: 'User created', user: safeUser })
  } catch (err) {
    console.log('had a problem creating new user', err)
    return res.status(500).json({ message: 'Registration failed' })
  }
})

// GET /users  -> { users }
// Auth required. Tighten to admin-only in a follow-up.
router.get('/', requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*')
    if (error) throw error
    return res.status(200).json({ users: data })
  } catch (err) {
    console.log('had a problem finding users', err)
    return res.status(500).json({ message: 'had a problem finding users' })
  }
})

// PUT /users/progress  -> { user }
// Matches the legacy contract: takes { email, articel, scrollProcentage } in body.
// (Known issue: caller-trusted email — flagged for a later security pass.)
router.put('/progress', async (req, res) => {
  try {
    const { articel, scrollProcentage } = req.body || {}
    // prefer authenticated user email when present, fall back to body.email for legacy callers
    const email = (req.user && req.user.email) || (req.body && req.body.email)
    if (!email) return res.status(400).json({ message: 'email required' })
    const { data: users, error: findErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1)
    if (findErr) throw findErr
    const user = users && users.length ? users[0] : null
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (articel === 'early History') {
      await supabase
        .from('users')
        .update({ is_early_history_completed: scrollProcentage })
        .eq('id', user.id)
    } else {
      await supabase
        .from('users')
        .update({ is_otef_aza_completed: scrollProcentage })
        .eq('id', user.id)
    }
    return res.status(200).json({ user })
  } catch (err) {
    console.log('had a problem updating user reading progress', err)
    return res.status(500).json({ message: 'Failed to update reading progress' })
  }
})

module.exports = router
