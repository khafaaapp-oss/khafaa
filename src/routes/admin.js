import express from 'express';
import mongoose from 'mongoose';
import fs from 'node:fs';

import { User } from '../models/User.js';
import { Chat } from '../models/Chat.js';
import { Message } from '../models/Message.js';
import { AdminLog } from '../models/AdminLog.js';

import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAdminAction } from '../utils/adminLog.js';
import { resolveMediaPath } from '../utils/media.js';

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/stats ────────────────────────────
router.get('/stats', async (_req, res, next) => {
  try {
    const [
      totalUsers,
      bannedUsers,
      onlineUsers,
      totalChats,
      totalMessages,
      totalDeletedMessages,
      totalMediaMessages,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBanned: true }),
      User.countDocuments({ isOnline: true }),
      Chat.countDocuments({}),
      Message.countDocuments({ permanentlyDeleted: false }),
      Message.countDocuments({ deletedForEveryone: true, permanentlyDeleted: false }),
      Message.countDocuments({ type: { $in: ['image', 'video', 'audio', 'file'] } }),
    ]);

    res.json({
      users: { total: totalUsers, banned: bannedUsers, online: onlineUsers },
      chats: { total: totalChats },
      messages: {
        total: totalMessages,
        deleted: totalDeletedMessages,
        media: totalMediaMessages,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/users?page=1&limit=20&q=&banned= ─
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const skip = (page - 1) * limit;
    const q = (req.query.q || '').toString().trim();
    const banned = req.query.banned;

    const query = {};
    if (q) {
      // Search by phone or name
      query.$or = [
        { phoneNumber: { $regex: q, $options: 'i' } },
        { displayName: { $regex: q, $options: 'i' } },
      ];
    }
    if (banned === 'true') query.isBanned = true;
    if (banned === 'false') query.isBanned = false;

    const [items, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    res.json({
      users: items.map((u) => ({
        id: u._id,
        phoneNumber: u.phoneNumber,
        displayName: u.displayName,
        role: u.role,
        isBanned: u.isBanned,
        banReason: u.banReason,
        isOnline: u.isOnline,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/users/:id ────────────────────────
router.get('/users/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [chatCount, messageCount, deletedCount] = await Promise.all([
      Chat.countDocuments({ participants: user._id }),
      Message.countDocuments({ senderId: user._id, permanentlyDeleted: false }),
      Message.countDocuments({
        senderId: user._id,
        deletedForEveryone: true,
        permanentlyDeleted: false,
      }),
    ]);

    await logAdminAction({
      adminId: req.user._id,
      action: 'view_user',
      targetType: 'user',
      targetId: user._id,
      req,
    });

    res.json({
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isBanned: user.isBanned,
        banReason: user.banReason,
        isOnline: user.isOnline,
        lastSeenAt: user.lastSeenAt,
        fcmTokenCount: user.fcmTokens?.length || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      stats: {
        chats: chatCount,
        messages: messageCount,
        deletedMessages: deletedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/admin/users/:id/ban ───────────────────
router.post('/users/:id/ban', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const reason = (req.body?.reason || '').toString().slice(0, 200);

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot ban an admin' });
    }
    if (user.isBanned) {
      return res.json({ ok: true, alreadyBanned: true });
    }

    user.isBanned = true;
    user.banReason = reason || 'Banned by admin';
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      action: 'ban_user',
      targetType: 'user',
      targetId: user._id,
      metadata: { reason: user.banReason },
      req,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/admin/users/:id/unban ─────────────────
router.post('/users/:id/unban', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isBanned) {
      return res.json({ ok: true, alreadyActive: true });
    }

    user.isBanned = false;
    user.banReason = null;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      action: 'unban_user',
      targetType: 'user',
      targetId: user._id,
      req,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/chats ────────────────────────────
router.get('/chats', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Chat.find({})
        .populate('participants', 'displayName phoneNumber avatarUrl')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Chat.countDocuments({}),
    ]);

    res.json({
      chats: items.map((c) => ({
        id: c._id,
        participants: c.participants.map((p) => ({
          id: p._id,
          displayName: p.displayName,
          phoneNumber: p.phoneNumber,
          avatarUrl: p.avatarUrl,
        })),
        lastMessage: c.lastMessage || null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/chats/:id/messages ───────────────
// Read-only. Includes deleted messages but EXCLUDES hard-deleted.
router.get('/chats/:id/messages', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid chat id' });
    }

    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const skip = (page - 1) * limit;

    const query = {
      chatId: chat._id,
      permanentlyDeleted: false, // hide hard-deleted from chat view
    };

    const [items, total] = await Promise.all([
      Message.find(query)
        .populate('senderId', 'displayName phoneNumber')
        .populate('receiverId', 'displayName phoneNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments(query),
    ]);

    res.json({
      messages: items.map((m) => ({
        id: m._id,
        sender: m.senderId,
        receiver: m.receiverId,
        type: m.type,
        content: m.content,
        metadata: m.metadata,
        viewMode: m.viewMode,
        viewDuration: m.viewDuration,
        viewCount: m.viewCount,
        viewedBy: m.viewedBy,
        readAt: m.readAt,
        deletedForEveryone: m.deletedForEveryone,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/trash/messages ───────────────────
// Lists soft-deleted messages (not yet hard-deleted).
router.get('/trash/messages', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const skip = (page - 1) * limit;

    const query = {
      deletedForEveryone: true,
      permanentlyDeleted: false,
    };

    const [items, total] = await Promise.all([
      Message.find(query)
        .populate('senderId', 'displayName phoneNumber')
        .populate('receiverId', 'displayName phoneNumber')
        .populate('deletedBy', 'displayName phoneNumber')
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments(query),
    ]);

    res.json({
      messages: items.map((m) => ({
        id: m._id,
        chatId: m.chatId,
        sender: m.senderId,
        receiver: m.receiverId,
        deletedBy: m.deletedBy,
        type: m.type,
        content: m.content,
        metadata: m.metadata,
        viewMode: m.viewMode,
        viewDuration: m.viewDuration,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/admin/trash/messages/:id ────────────
// Hard delete: removes from DB and deletes the file.
router.delete('/trash/messages/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.deletedForEveryone) {
      return res.status(400).json({
        error: 'Message is not in trash. Soft-delete it first.',
      });
    }

    // Delete associated media file if any
    if (['image', 'video', 'audio', 'file'].includes(message.type)) {
      const fullPath = resolveMediaPath(message.content);
      if (fullPath) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error('Failed to delete media file:', err.message);
        }
      }
    }

    // Hard delete
    message.permanentlyDeleted = true;
    message.permanentlyDeletedAt = new Date();
    message.permanentlyDeletedBy = req.user._id;
    await message.save();

    await logAdminAction({
      adminId: req.user._id,
      action: 'delete_message',
      targetType: 'message',
      targetId: message._id,
      metadata: {
        chatId: message.chatId,
        senderId: message.senderId,
        receiverId: message.receiverId,
        type: message.type,
      },
      req,
    });

    res.json({ ok: true, permanentlyDeleted: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/admin/trash/messages/:id/restore ──────
router.post('/trash/messages/:id/restore', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.permanentlyDeleted) {
      return res.status(400).json({ error: 'Message is permanently deleted' });
    }
    if (!message.deletedForEveryone) {
      return res.status(400).json({ error: 'Message is not deleted' });
    }

    message.deletedForEveryone = false;
    message.deletedAt = null;
    message.deletedBy = null;
    await message.save();

    // Restore chat.lastMessage if this is now the newest visible message
    const chat = await Chat.findById(message.chatId);
    if (chat) {
      const newest = await Message.findOne({
        chatId: chat._id,
        deletedForEveryone: false,
        permanentlyDeleted: false,
      }).sort({ createdAt: -1 });

      if (newest) {
        chat.lastMessage = {
          messageId: newest._id,
          preview:
            newest.type === 'text'
              ? newest.content.slice(0, 100)
              : `[${newest.type}]`,
          type: newest.type,
          senderId: newest.senderId,
          at: newest.createdAt,
        };
        await chat.save();
      }
    }

    await logAdminAction({
      adminId: req.user._id,
      action: 'restore_message',
      targetType: 'message',
      targetId: message._id,
      metadata: { chatId: message.chatId },
      req,
    });

    res.json({ ok: true, restored: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/logs ─────────────────────────────
router.get('/logs', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const skip = (page - 1) * limit;
    const action = (req.query.action || '').toString().trim();

    const query = {};
    if (action) query.action = action;

    const [items, total] = await Promise.all([
      AdminLog.find(query)
        .populate('adminId', 'displayName phoneNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AdminLog.countDocuments(query),
    ]);

    res.json({
      logs: items.map((l) => ({
        id: l._id,
        admin: l.adminId,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        metadata: l.metadata,
        ip: l.ip,
        createdAt: l.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/admin/broadcast ───────────────────────
// Placeholder. Actual FCM push will be added in a later stage.
router.post('/broadcast', async (req, res, next) => {
  try {
    const title = (req.body?.title || '').toString().slice(0, 100);
    const body = (req.body?.body || '').toString().slice(0, 500);
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    await logAdminAction({
      adminId: req.user._id,
      action: 'broadcast',
      targetType: 'broadcast',
      metadata: { title, body },
      req,
    });

    // TODO: send FCM to all users in a later stage
    res.json({ ok: true, note: 'FCM sending not implemented yet' });
  } catch (err) {
    next(err);
  }
});

export default router;
