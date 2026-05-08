const { jwtVerify, SignJWT } = require('jose')

let cachedSecretKey = null

function secretKey() {
  if (cachedSecretKey) return cachedSecretKey
  const raw = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET
  if (!raw) throw new Error('JWT_SECRET or NEXTAUTH_SECRET must be set')
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
      res.status(401).json({ message: 'Not authorized' })
      return
    }
    req.user = await verifyJwt(auth.slice(7))
    next()
  } catch (err) {
    console.error('JWT verification failed:', err && err.message ? err.message : err)
    res.status(401).json({ message: 'Not authorized' })
  }
}

module.exports = { verifyJwt, requireAuth }
async function signJwt(payload, expires = '1h') {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secretKey())
  return token
}

module.exports = { verifyJwt, requireAuth, signJwt }