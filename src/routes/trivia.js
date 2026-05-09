const express = require('express')
const supabase = require('../db/supabase')
const { requireAuth } = require('../middleware/auth')
const { questions, QUESTIONS_VERSION } = require('../assets/Questions')

const router = express.Router()

// GET /trivia/questions  -> { questions, version, count }
router.get('/questions', requireAuth, (_req, res) => {
  return res.status(200).json({
    questions,
    version: QUESTIONS_VERSION,
    count: questions.length,
  })
})

// POST /trivia/createRoom  -> { newRoom }
router.post('/createRoom', requireAuth, async (req, res) => {
  try {
    const { name } = req.body || {}
    if (!name) return res.status(400).json({ message: 'name required' })
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ name, participants: [] }])
      .select()
      .single()
    if (error) throw error
    return res.status(200).json({ newRoom: data })
  } catch (err) {
    console.log('had a problem creating new room', err)
    return res.status(500).json({ message: 'Had problem creating room' })
  }
})

// PUT /trivia/addPlayer  -> { message, updateResult }
router.put('/addPlayer', requireAuth, async (req, res) => {
  try {
    const { roomId, player } = req.body || {}
    if (!roomId || !player) {
      return res.status(400).json({ message: 'Missing roomId or player' })
    }
    // Admin assignment is server-side (socket joinRoom). Ignore any client-supplied isAdmin.
    const newPlayer = {
      name: player.name,
      nickName: player.nickName,
      img: player.img,
      answers: [],
    }

    const { data: roomData, error: fetchErr } = await supabase
      .from('rooms')
      .select('participants')
      .eq('id', roomId)
      .single()
    if (fetchErr) throw fetchErr

    const participants = Array.isArray(roomData.participants) ? roomData.participants : []
    participants.push(newPlayer)

    const { data: updated, error: updateErr } = await supabase
      .from('rooms')
      .update({ participants })
      .eq('id', roomId)
      .select()
      .single()
    if (updateErr) throw updateErr

    return res.status(200).json({ message: 'Room was updated', updateResult: updated })
  } catch (err) {
    console.error('Had a problem updating room participants list', err)
    return res.status(500).json({ message: 'Had a problem updating the room' })
  }
})

// POST /trivia/getRoom  -> { room }
// Looks up by NAME (legacy endpoint name was getRoomById but it queries by name).
router.post('/getRoom', requireAuth, async (req, res) => {
  try {
    const { name } = req.body || {}
    if (!name) return res.status(400).json({ message: 'name required' })
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('name', name)
      .limit(1)
    if (error) throw error
    const room = data && data.length ? data[0] : null
    return res.status(200).json({ room })
  } catch (err) {
    console.log('had a problem finding room', err)
    return res.status(500).json({ message: 'had a problem finding room' })
  }
})

// POST /trivia/getParticipants  -> { room }
router.post('/getParticipants', requireAuth, async (req, res) => {
  try {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ message: 'id required' })
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .limit(1)
    if (error) throw error
    const room = data && data.length ? data[0] : null
    if (!room) return res.status(404).json({ message: 'Room not found' })
    return res.status(200).json({ room })
  } catch (err) {
    console.log('had a problem finding room', err)
    return res.status(500).json({ message: 'had a problem finding room' })
  }
})

module.exports = router
