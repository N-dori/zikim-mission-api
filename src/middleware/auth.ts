import { jwtVerify } from 'jose'
import type { Request, Response, NextFunction } from 'express'

let cachedSecretKey: Uint8Array | null = null

function secretKey(): Uint8Array {
  if (cachedSecretKey) return cachedSecretKey
  const raw = process.env.JWT_SECRET
  if (!raw) throw new Error('JWT_SECRET must be set')
  cachedSecretKey = new TextEncoder().encode(raw)
  return cachedSecretKey
}

export async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
  return payload as Record<string, unknown>
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Not authorized' })
      return
    }
    ;(req as Request & { user: unknown }).user = await verifyJwt(auth.slice(7))
    next()
  } catch {
    res.status(401).json({ message: 'Not authorized' })
  }
}
