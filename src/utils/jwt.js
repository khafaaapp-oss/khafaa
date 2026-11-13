import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!SECRET) {
  console.error('❌ JWT_SECRET is not set in .env');
  process.exit(1);
}

/**
 * Signs a JWT for the given user.
 */
export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

/**
 * Verifies a JWT and returns its payload, or throws.
 */
export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
