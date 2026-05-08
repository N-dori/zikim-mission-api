const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
}

// Realtime client in @supabase/supabase-js requires a WebSocket constructor on Node < 22.
// Try to polyfill using the 'ws' package when available (helpful for CI runners on Node 20).
try {
  if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line global-require
    const ws = require('ws')
    if (ws) globalThis.WebSocket = ws
  }
} catch (e) {
  // ignore error — if ws isn't installed the client will surface an error later
}

const supabase = createClient(supabaseUrl, supabaseKey)

module.exports = supabase
