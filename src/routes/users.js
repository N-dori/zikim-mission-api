const express = require('express')
const bcrypt = require('bcryptjs')
const supabase = require('../db/supabase')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// POST /users/exists  -> { user }
// Used by login + signup to check whether an email is registered.
router.post('/exists', async (req, res) => {
  try {
    const { email } = req.body || {}
    if (!email) return res.status(400).json({ message: 'email required' })
    const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1)
    if (error) throw error
    const user = data && data.length ? data[0] : null
    return res.status(201).json({ user })
  } catch (err) {
    console.log('had a problem finding user', err)
    return res.status(500).json({ message: 'had a problem finding user' })
  }
})

// POST /users/login  -> { user } (without password hash) | 401
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ message: 'email and password required' })
    const { data, error } = await supabase.from('users').select('*').eq('email', email).limit(1)
    if (error) throw error
    const user = data && data.length ? data[0] : null
    if (!user) return res.status(401).json({ message: 'invalid credentials' })
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ message: 'invalid credentials' })
    const { password: _pw, ...safeUser } = user
    return res.status(200).json({ user: safeUser })
  } catch (err) {
    console.log('login failed', err)
    return res.status(500).json({ message: 'login failed' })
  }
})

// POST /users/register  -> { message, user }
router.post('/register', async (req, res) => {
  try {
    const { name, email, battalion, password } = req.body || {}
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'missing required fields' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, battalion, password: hashedPassword }])
    if (error) throw error
    return res.status(201).json({ message: 'User created', user: data })
  } catch (err) {
    console.log('had a problem creating new user', err)
    return res.status(500).json({ message: 'Had problem during registration' })
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
    const { email, articel, scrollProcentage } = req.body || {}
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
    return res.status(201).json({ user })
  } catch (err) {
    console.log('had a problem updating user reading progress', err)
    return res.status(500).json({ message: 'had a problem finding user' })
  }
})

module.exports = router
