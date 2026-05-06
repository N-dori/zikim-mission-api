const { jwtVerify } = require('jose')

let cachedSecretKey = null

function secretKey() {
  if (cachedSecretKey) return cachedSecretKey
  const raw = process.env.NEXTAUTH_SECRET
  if (!raw) throw new Error('NEXTAUTH_SECRET must be set')
  cachedSecretKey = new TextEncoder().encode(raw)
  return cachedSecretKey
}

async function verifyJwt(token) {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
  return payload
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized' })
    }
    req.user = await verifyJwt(auth.slice(7))
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized' })
  }
}

module.exports = { requireAuth, verifyJwt }
