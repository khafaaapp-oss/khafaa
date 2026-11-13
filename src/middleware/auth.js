import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';

/**
 * Protects routes. Attaches req.user (without passwordHash).
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const payload = verifyToken(token);

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'Account is banned', reason: user.banReason });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Must be used AFTER requireAuth.
 * Rejects non-admins with 403.
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
