const express = require('express')

const router = express.Router()

const WIKI_HEADERS = {
  'User-Agent': 'zikim-mission/1.0 (https://github.com/N-dori/zikim-mission-api)',
  'Accept': 'application/json',
}

// POST /wiki  -> { data }
// Wikipedia article extract proxy.
router.post('/', async (req, res) => {
  try {
    const { txt } = req.body || {}
    if (!txt) return res.status(400).json({ message: 'txt required' })
    const url = `https://he.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(txt)}&prop=extracts&format=json&exintro=1`
    const wiki = await fetch(url, { headers: WIKI_HEADERS })
    const data = await wiki.json()
    return res.json({ data })
  } catch (err) {
    console.log('wiki error', err)
    return res.status(500).json({ message: 'wiki lookup failed' })
  }
})

// POST /wiki/link  -> { data }
// Wikipedia opensearch suggestion proxy.
router.post('/link', async (req, res) => {
  try {
    const { txt } = req.body || {}
    if (!txt) return res.status(400).json({ message: 'txt required' })
    const url = `https://he.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(txt)}&limit=1&format=json`
    const wiki = await fetch(url, { headers: WIKI_HEADERS })
    const data = await wiki.json()
    return res.json({ data })
  } catch (err) {
    console.log('wiki link error', err)
    return res.status(500).json({ message: 'wiki link lookup failed' })
  }
})

module.exports = router
