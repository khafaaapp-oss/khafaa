import express from 'express';
import { z } from 'zod';

import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { isValidPhoneNumber } from '../utils/phone.js';

const router = express.Router();

// ── Helpers ─────────────────────────────────────────
function publicUser(user) {
  return {
    id: user._id,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    lastSeenAt: user.lastSeenAt,
    isOnline: user.isOnline,
    role: user.role, // useful for clients to know if this is an admin
  };
}

// ── Schemas ─────────────────────────────────────────
const updateMeSchema = z.object({
  displayName: z.string().trim().min(2).max(50).optional(),
  bio: z.string().max(200).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const fcmTokenSchema = z.object({
  token: z.string().min(10).max(500),
});

// ── GET /api/users/search?q=12345678901 ─────────────
router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!isValidPhoneNumber(q)) {
      return res.status(400).json({ error: 'Query must be an 11-digit phone number' });
    }

    // Do not return yourself in search results
    const user = await User.findOne({
      phoneNumber: q,
      _id: { $ne: req.user._id },
      isBanned: false,
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/users/:id ──────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    next(err);
  }
});

// ── PATCH /api/users/me ─────────────────────────────
router.patch(
  '/me',
  requireAuth,
  validateBody(updateMeSchema),
  async (req, res, next) => {
    try {
      const updates = req.body;
      Object.assign(req.user, updates);
      await req.user.save();
      res.json({ user: publicUser(req.user) });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/users/me/fcm-token ────────────────────
router.post(
  '/me/fcm-token',
  requireAuth,
  validateBody(fcmTokenSchema),
  async (req, res, next) => {
    try {
      const { token } = req.body;
      if (!req.user.fcmTokens.includes(token)) {
        req.user.fcmTokens.push(token);
        await req.user.save();
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/users/me/fcm-token ──────────────────
router.delete(
  '/me/fcm-token',
  requireAuth,
  validateBody(fcmTokenSchema),
  async (req, res, next) => {
    try {
      const { token } = req.body;
      req.user.fcmTokens = req.user.fcmTokens.filter((t) => t !== token);
      await req.user.save();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
