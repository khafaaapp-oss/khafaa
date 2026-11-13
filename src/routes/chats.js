import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { Chat, buildPairKey } from '../models/Chat.js';
import { User } from '../models/User.js';
import { Message } from '../models/Message.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = express.Router();

// ── Schemas ─────────────────────────────────────────
const createChatSchema = z.object({
  peerId: z.string().min(1, 'peerId is required'),
});

// ── Helpers ─────────────────────────────────────────
function chatSummary(chat, currentUserId) {
  const peer = chat.participants.find(
    (p) => p.toString() !== currentUserId.toString()
  );
  const unread = chat.unreadCounts?.get?.(currentUserId.toString()) || 0;

  return {
    id: chat._id,
    peerId: peer ? peer.toString() : null,
    pairKey: chat.pairKey,
    lastMessage: chat.lastMessage || null,
    unreadCount: unread,
    updatedAt: chat.updatedAt,
    createdAt: chat.createdAt,
  };
}

// ── POST /api/chats ─────────────────────────────────
// Body: { peerId }
// Creates a chat if it doesn't exist, or returns the existing one.
router.post('/', requireAuth, validateBody(createChatSchema), async (req, res, next) => {
  try {
    const { peerId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(peerId)) {
      return res.status(400).json({ error: 'Invalid peerId' });
    }
    if (peerId === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot chat with yourself' });
    }

    const peer = await User.findById(peerId);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    if (peer.isBanned) return res.status(403).json({ error: 'Peer is banned' });

    const pairKey = buildPairKey(req.user._id, peer._id);

    let chat = await Chat.findOne({ pairKey });
    let created = false;

    if (!chat) {
      chat = await Chat.create({
        participants: [req.user._id, peer._id],
        pairKey,
      });
      created = true;
    }

    res.status(created ? 201 : 200).json({
      created,
      chat: chatSummary(chat, req.user._id),
    });
  } catch (err) {
    if (err.code === 11000) {
      // race condition: another request created the chat simultaneously
      const pairKey = buildPairKey(req.user._id, req.body.peerId);
      const chat = await Chat.findOne({ pairKey });
      return res.status(200).json({
        created: false,
        chat: chatSummary(chat, req.user._id),
      });
    }
    next(err);
  }
});

// ── GET /api/chats ──────────────────────────────────
// Returns all chats for the current user, sorted by last activity.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(100);

    res.json({
      chats: chats.map((c) => chatSummary(c, req.user._id)),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/chats/:id ──────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid chat id' });
    }

    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isParticipant = chat.participants.some(
      (p) => p.toString() === req.user._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this chat' });
    }

    res.json({ chat: chatSummary(chat, req.user._id) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/chats/:id/read ────────────────────────
// Marks all messages in this chat as read for the current user.
router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid chat id' });
    }

    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const isParticipant = chat.participants.some(
      (p) => p.toString() === req.user._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this chat' });
    }

    // Mark all incoming messages as read
    await Message.updateMany(
      {
        chatId: chat._id,
        receiverId: req.user._id,
        readAt: null,
        deletedForEveryone: false,
        permanentlyDeleted: false,
      },
      { $set: { readAt: new Date() } }
    );

    // Reset unread counter
    chat.unreadCounts.set(req.user._id.toString(), 0);
    await chat.save();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
