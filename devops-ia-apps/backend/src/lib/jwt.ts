import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET ?? 'change-me-in-production'
const EXPIRY = process.env.JWT_EXPIRY ?? '8h'

export interface TokenPayload {
  sub: string
  email: string
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY } as jwt.SignOptions)
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload
}
