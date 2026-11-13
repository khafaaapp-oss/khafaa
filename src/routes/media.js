import express from 'express';
import mongoose from 'mongoose';
import fs from 'node:fs';

import { Message } from '../models/Message.js';
import { Chat } from '../models/Chat.js';
import { requireAuth } from '../middleware/auth.js';
import { buildUploader, UPLOAD_DIR } from '../utils/upload.js';
import { resolveMediaPath, mimeFromExt, canViewMessageMedia } from '../utils/media.js';

const router = express.Router();

// ── POST /api/media/:kind/upload ────────────────────
// kind: image | video | audio | file
// Multipart form-data: file=<binary>
// Returns: { url, fileName, size, mimeType }
router.post(
  '/:kind/upload',
  requireAuth,
  (req, res, next) => {
    const kind = req.params.kind;
    if (!['image', 'video', 'audio', 'file'].includes(kind)) {
      return res.status(400).json({ error: 'Invalid media kind' });
    }
    const uploader = buildUploader(kind);
    uploader(req, res, (err) => {
      if (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
      }
      res.status(201).json({
        fileName: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        // This is what the client will send back when creating the message
        content: `uploads/${req.file.filename}`,
      });
    });
  }
);

// ── GET /api/media/:messageId/stream ────────────────
// Protected media stream.
router.get('/:messageId/stream', requireAuth, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: 'Invalid messageId' });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.deletedForEveryone || message.permanentlyDeleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!['image', 'video', 'audio', 'file'].includes(message.type)) {
      return res.status(400).json({ error: 'Message has no media' });
    }

    // Participant check via Chat (single source of truth)
    const chat = await Chat.findById(message.chatId).select('participants');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const userId = req.user._id.toString();
    const isParticipant = chat.participants.some((p) => p.toString() === userId);
    const isAdmin = req.user.role === 'admin';
    if (!isParticipant && !isAdmin) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    // View-once / timed rules
    const check = canViewMessageMedia(message, req.user);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }

    const fullPath = resolveMediaPath(message.content);
    if (!fullPath) return res.status(404).json({ error: 'File not found on server' });

    // Consume view (only for receivers on once/timed)
    if (check.consumeView) {
      message.viewedBy = req.user._id;
      message.viewedAt = new Date();
      message.viewCount = (message.viewCount || 0) + 1;
      await message.save();
    }

    const mime = mimeFromExt(fullPath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    const stream = fs.createReadStream(fullPath);
    stream.on('error', (err) => {
      console.error('stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
