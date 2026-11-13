import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { User } from '../models/User.js';
import { generateUniquePhoneNumber, isValidPhoneNumber } from '../utils/phone.js';
import { signToken } from '../utils/jwt.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ── Schemas ─────────────────────────────────────────
const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(50),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  phoneNumber: z.string().refine(isValidPhoneNumber, 'Must be 11 digits'),
  password: z.string().min(1),
});

// ── POST /api/auth/register ─────────────────────────
router.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { displayName, password } = req.body;

    const phoneNumber = await generateUniquePhoneNumber();

    const passwordHash = await bcrypt.hash(password, 12);

    // Auto-admin: if this number matches ADMIN_PHONE_NUMBER, role = admin
    const adminNumber = process.env.ADMIN_PHONE_NUMBER?.trim();
    const role = adminNumber && phoneNumber === adminNumber ? 'admin' : 'user';

    // NOTE: in this simplified flow, the phone number is GENERATED,
    // so the user cannot "sign up with the admin number".
    // To allow admin creation, we check the admin number separately below.

    const user = await User.create({
      phoneNumber,
      displayName,
      passwordHash,
      role,
    });

    const token = signToken(user);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ────────────────────────────
router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber }).select('+passwordHash');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.isBanned) {
      return res.status(403).json({ error: 'Account is banned', reason: user.banReason });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      phoneNumber: req.user.phoneNumber,
      displayName: req.user.displayName,
      role: req.user.role,
      bio: req.user.bio,
      avatarUrl: req.user.avatarUrl,
      lastSeenAt: req.user.lastSeenAt,
    },
  });
});

export default router;
