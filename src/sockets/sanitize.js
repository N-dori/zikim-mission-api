const NICKNAME_MAX = 32
const IMG_URL_MAX = 512

// Build a regex matching:
//   - C0 controls (U+0000..U+001F) and DEL (U+007F)
//   - C1 controls (U+0080..U+009F)
//   - Zero-width / bidi formatting (U+200B..U+200F, U+202A..U+202E, U+2060, U+FEFF)
const CONTROL_AND_FORMATTING_RE = new RegExp(
  '[' +
    '\\u0000-\\u001F' +
    '\\u007F-\\u009F' +
    '\\u200B-\\u200F' +
    '\\u202A-\\u202E' +
    '\\u2060' +
    '\\uFEFF' +
    ']',
  'g'
)

function sanitizeNickName(value) {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(CONTROL_AND_FORMATTING_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, NICKNAME_MAX)
}

function sanitizeImgUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length > IMG_URL_MAX) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // permit relative asset paths
  if (/^[a-zA-Z0-9_\-./]+$/.test(trimmed)) return trimmed
  return ''
}

module.exports = { sanitizeNickName, sanitizeImgUrl, NICKNAME_MAX, IMG_URL_MAX }
