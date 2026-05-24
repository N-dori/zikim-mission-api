const express = require('express')
const supabase = require('../db/supabase')
const { requireAuth } = require('../middleware/auth')
const { questions, QUESTIONS_VERSION } = require('../assets/Questions')
// In-memory live-room registry (shared singleton with the socket layer).
const { __rooms } = require('../sockets')

const router = express.Router()

const JOIN_GRACE_MS = 3 * 60 * 1000 // a freshly-created room is joinable before anyone connects

// Friendly label from a possibly-suffixed stored name ("מחלקה א_2" -> "מחלקה א").
function roomLabel(name) {
  return String(name || '').replace(/_\d+$/, '')
}

// Pick a unique stored name for a label: "label", else "label_2", "label_3"...
function nextRoomName(label, existingNames) {
  const taken = new Set(existingNames)
  if (!taken.has(label)) return label
  let n = 2
  while (taken.has(`${label}_${n}`)) n++
  return `${label}_${n}`
}

function suffixNum(name) {
  const m = String(name).match(/_(\d+)$/)
  return m ? Number(m[1]) : 1
}

// A room is joinable if a game is live on it, or it was created moments ago
// (covers the gap between createRoom and the creator's socket connecting).
function isRoomJoinable(room) {
  try {
    const meta = __rooms && __rooms.get(room.id)
    if (meta && Object.values(meta.state.players).some((p) => p.connected)) return true
  } catch (_e) { /* ignore */ }
  if (room.created_at) {
    return Date.now() - Date.parse(room.created_at) < JOIN_GRACE_MS
  }
  return false
}

function pickNewest(rooms) {
  if (!rooms.length) return null
  return [...rooms].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    if (tb !== ta) return tb - ta
    return suffixNum(b.name) - suffixNum(a.name)
  })[0]
}

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
    const label = roomLabel(name)
    // Keep the friendly label but store a unique name (label, label_2, label_3...).
    const { data: rows, error: fetchErr } = await supabase.from('rooms').select('name')
    if (fetchErr) throw fetchErr
    const uniqueName = nextRoomName(label, (rows || []).map((r) => r.name))
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ name: uniqueName, participants: [] }])
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
    const label = roomLabel(name)
    const { data, error } = await supabase.from('rooms').select('*')
    if (error) throw error
    // Same friendly label joins the LIVE (or just-created) room; otherwise null
    // so the caller opens a fresh room.
    const matches = (data || []).filter((r) => roomLabel(r.name) === label)
    const joinable = matches.filter((r) => isRoomJoinable(r))
    const room = pickNewest(joinable)
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
