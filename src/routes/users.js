const express = require('express')
const bcrypt = require('bcryptjs')
const supabase = require('../db/supabase')
const { requireAuth, signJwt } = require('../middleware/auth')
const rateLimit = require('express-rate-limit')

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, try again later' }
})

function isValidEmail(email) {
  if (typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 1
}

const router = express.Router()

router.post('/exists', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) return res.status(400).json({ message: 'email required' })
    if (!isValidEmail(email)) return res.status(400).json({ message: 'invalid email' })

    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1)

    if (error) throw error

    return res.status(200).json({ exists: !!(data && data.length) })
  } catch (err) {
    console.log('had a problem finding user', err)
    return res.status(500).json({ message: 'User lookup failed' })
  }
})

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}

    if (!email || !password)
      return res.status(400).json({ message: 'email and password required' })

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1)

    if (error) throw error

    const user = data?.[0]
    if (!user) return res.status(401).json({ message: 'invalid credentials' })

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ message: 'invalid credentials' })

    const { password: _pw, ...safeUser } = user

    let token = null
    try {
      token = await signJwt({ id: safeUser.id, email: safeUser.email })
    } catch (e) {
      console.error('JWT error', e)
    }

    return res.status(200).json({ user: safeUser, token })
  } catch (err) {
    console.log('login failed', err)
    return res.status(500).json({ message: 'Login failed' })
  }
})

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, battalion, password } = req.body || {}

    if (!name || !email || !password)
      return res.status(400).json({ message: 'missing required fields' })

    const hashedPassword = await bcrypt.hash(password, 10)

    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, battalion, password: hashedPassword }])
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ message: 'email already in use' })
      throw error
    }

    const { password: _pw, ...safeUser } = data

    return res.status(201).json({ message: 'User created', user: safeUser })
  } catch (err) {
    console.log('registration failed', err)
    return res.status(500).json({ message: 'Registration failed' })
  }
})

router.get('/', requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*')
    if (error) throw error

    return res.status(200).json({ users: data })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ message: 'failed to fetch users' })
  }
})

router.put('/progress', async (req, res) => {
  try {
    const { articel, scrollProcentage } = req.body || {}
    const email = req.body?.email

    if (!email)
      return res.status(400).json({ message: 'email required' })

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1)

    const user = users?.[0]
    if (!user) return res.status(404).json({ message: 'User not found' })

    const updateField =
      articel === 'early History'
        ? { is_early_history_completed: scrollProcentage }
        : { is_otef_aza_completed: scrollProcentage }

    await supabase
      .from('users')
      .update(updateField)
      .eq('id', user.id)

    return res.status(200).json({ user })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ message: 'update failed' })
  }
})

module.exports = router