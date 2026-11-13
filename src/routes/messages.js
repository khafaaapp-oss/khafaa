import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { Message } from '../models/Message.js';
import { Chat } from '../models/Chat.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = express.Router();

// ── Schemas ─────────────────────────────────────────
const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  type: z.enum(['text']).default('text'), // media types handled in a later stage
  content: z.string().trim().min(1).max(5000),
});

// ── Helpers ─────────────────────────────────────────
function serializeMessage(msg) {
  return {
    id: msg._id,
    chatId: msg.chatId,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    type: msg.type,
    content: msg.content,
    metadata: msg.metadata,
    readAt: msg.readAt,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

async function assertParticipant(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const err = new Error('Chat not found');
    err.status = 404;
    throw err;
  }
  const isParticipant = chat.participants.some(
    (p) => p.toString() === userId.toString()
  );
  if (!isParticipant) {
    const err = new Error('Not a participant in this chat');
    err.status = 403;
    throw err;
  }
  return chat;
}

// ── POST /api/messages ──────────────────────────────
router.post('/', requireAuth, validateBody(sendMessageSchema), async (req, res, next) => {
  try {
    const { chatId, type, content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ error: 'Invalid chatId' });
    }

    const chat = await assertParticipant(chatId, req.user._id);

    const receiverId = chat.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );

    const message = await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      receiverId,
      type,
      content,
    });

    // Update chat: lastMessage + unread counter
    chat.lastMessage = {
      messageId: message._id,
      preview: content.slice(0, 100),
      type,
      senderId: req.user._id,
      at: message.createdAt,
    };
    const currentUnread = chat.unreadCounts.get(receiverId.toString()) || 0;
    chat.unreadCounts.set(receiverId.toString(), currentUnread + 1);
    await chat.save();

    res.status(201).json({ message: serializeMessage(message) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/messages?chatId=...&before=...&limit=30
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const chatId = (req.query.chatId || '').toString();
    const before = (req.query.before || '').toString();
    const limit = Math.min(parseInt(req.query.limit || '30', 10) || 30, 100);

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ error: 'Invalid chatId' });
    }

    await assertParticipant(chatId, req.user._id);

    const query = {
      chatId,
      deletedForEveryone: false,
      permanentlyDeleted: false,
    };

    // Pagination: "before" is a message id — fetch messages older than it
    if (before) {
      if (!mongoose.Types.ObjectId.isValid(before)) {
        return res.status(400).json({ error: 'Invalid before cursor' });
      }
      const beforeMsg = await Message.findById(before).select('createdAt');
      if (beforeMsg) {
        query.createdAt = { $lt: beforeMsg.createdAt };
      }
    }

    // Fetch newest-first, then reverse for chronological display
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const sliced = hasMore ? messages.slice(0, limit) : messages;
    sliced.reverse();

    res.json({
      messages: sliced.map(serializeMessage),
      hasMore,
      nextCursor: hasMore ? sliced[0]._id : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/messages/:id/read ─────────────────────
router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Only the receiver can mark as read
    if (message.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the receiver can mark as read' });
    }

    if (!message.readAt) {
      message.readAt = new Date();
      await message.save();
    }

    res.json({ message: serializeMessage(message) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/messages/:id ────────────────────────
// Silent soft delete for both parties.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Only the sender can delete
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the sender can delete this message' });
    }

    if (message.deletedForEveryone) {
      return res.json({ ok: true, alreadyDeleted: true });
    }

    message.deletedForEveryone = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    await message.save();

    // Update chat's lastMessage if this was the last message
    const chat = await Chat.findById(message.chatId);
    if (chat && chat.lastMessage?.messageId?.toString() === message._id.toString()) {
      // Find the previous visible message
      const previous = await Message.findOne({
        chatId: chat._id,
        _id: { $ne: message._id },
        deletedForEveryone: false,
        permanentlyDeleted: false,
      }).sort({ createdAt: -1 });

      if (previous) {
        chat.lastMessage = {
          messageId: previous._id,
          preview: previous.content.slice(0, 100),
          type: previous.type,
          senderId: previous.senderId,
          at: previous.createdAt,
        };
      } else {
        chat.lastMessage = null;
      }
      await chat.save();
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
