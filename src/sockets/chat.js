import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { Chat } from '../models/Chat.js';

export function registerChatHandlers(io, socket) {
  const userId = socket.userId;

  // ── Send message (text or media) ──────────────────
  socket.on('message:send', async (payload, ack) => {
    try {
      const {
        chatId,
        content = '',
        type = 'text',
        viewMode = 'normal',
        viewDuration = null,
        metadata = {},
      } = payload || {};

      if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        return ack?.({ error: 'Invalid chatId' });
      }

      // Validate type
      if (!['text', 'image', 'video', 'audio', 'file'].includes(type)) {
        return ack?.({ error: 'Invalid message type' });
      }

      // Text requires content
      if (type === 'text' && (!content || !content.trim())) {
        return ack?.({ error: 'Message content is required' });
      }

      // Media requires content (the file path) + metadata
      if (type !== 'text' && !content) {
        return ack?.({ error: 'Media path is required' });
      }

      // View-once only for image/video
      if (['once', 'timed'].includes(viewMode) && !['image', 'video'].includes(type)) {
        return ack?.({ error: 'View-once is only available for images/videos' });
      }

      const chat = await Chat.findById(chatId);
      if (!chat) return ack?.({ error: 'Chat not found' });

      const isParticipant = chat.participants.some((p) => p.toString() === userId);
      if (!isParticipant) return ack?.({ error: 'Not a participant in this chat' });

      const receiverId = chat.participants.find((p) => p.toString() !== userId);

      const message = await Message.create({
        chatId: chat._id,
        senderId: userId,
        receiverId,
        type,
        content,
        metadata,
        viewMode,
        viewDuration,
      });

      // Update chat lastMessage + unread
      const previewText =
        type === 'text'
          ? content.slice(0, 100)
          : type === 'image'
          ? '📷 Photo'
          : type === 'video'
          ? '🎥 Video'
          : type === 'audio'
          ? '🎤 Voice message'
          : '📎 File';

      chat.lastMessage = {
        messageId: message._id,
        preview: previewText,
        type,
        senderId: userId,
        at: message.createdAt,
      };
      const currentUnread = chat.unreadCounts.get(receiverId.toString()) || 0;
      chat.unreadCounts.set(receiverId.toString(), currentUnread + 1);
      await chat.save();

      const serialized = serializeMessage(message);

      io.to(`user:${receiverId}`).emit('message:new', serialized);
      io.to(`user:${userId}`).emit('message:new', serialized);

      ack?.({ ok: true, message: serialized });
    } catch (err) {
      console.error('message:send error:', err);
      ack?.({ error: 'Failed to send message' });
    }
  });

  // ── Mark as read ──────────────────────────────────
  socket.on('message:read', async (payload, ack) => {
    try {
      const { messageId } = payload || {};
      if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
        return ack?.({ error: 'Invalid messageId' });
      }

      const message = await Message.findById(messageId);
      if (!message) return ack?.({ error: 'Message not found' });
      if (message.receiverId.toString() !== userId) {
        return ack?.({ error: 'Only the receiver can mark as read' });
      }
      if (message.readAt) return ack?.({ ok: true, alreadyRead: true });

      message.readAt = new Date();
      await message.save();

      io.to(`user:${message.senderId}`).emit('message:read_by', {
        messageId: message._id,
        readAt: message.readAt,
        byUserId: userId,
      });

      ack?.({ ok: true });
    } catch (err) {
      console.error('message:read error:', err);
      ack?.({ error: 'Failed to mark as read' });
    }
  });

  // ── Silent delete ─────────────────────────────────
  socket.on('message:delete', async (payload, ack) => {
    try {
      const { messageId } = payload || {};
      if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
        return ack?.({ error: 'Invalid messageId' });
      }

      const message = await Message.findById(messageId);
      if (!message) return ack?.({ error: 'Message not found' });
      if (message.senderId.toString() !== userId) {
        return ack?.({ error: 'Only the sender can delete this message' });
      }
      if (message.deletedForEveryone) {
        return ack?.({ ok: true, alreadyDeleted: true });
      }

      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      message.deletedBy = userId;
      await message.save();

      const chat = await Chat.findById(message.chatId);
      if (chat && chat.lastMessage?.messageId?.toString() === message._id.toString()) {
        const previous = await Message.findOne({
          chatId: chat._id,
          _id: { $ne: message._id },
          deletedForEveryone: false,
          permanentlyDeleted: false,
        }).sort({ createdAt: -1 });

        chat.lastMessage = previous
          ? {
              messageId: previous._id,
              preview: previous.content.slice(0, 100),
              type: previous.type,
              senderId: previous.senderId,
              at: previous.createdAt,
            }
          : null;
        await chat.save();
      }

      const payloadOut = {
        messageId: message._id.toString(),
        chatId: message.chatId.toString(),
      };
      io.to(`user:${message.senderId}`).emit('message:deleted', payloadOut);
      io.to(`user:${message.receiverId}`).emit('message:deleted', payloadOut);

      ack?.({ ok: true });
    } catch (err) {
      console.error('message:delete error:', err);
      ack?.({ error: 'Failed to delete message' });
    }
  });

  // ── Typing indicators ─────────────────────────────
  socket.on('typing:start', async (payload) => {
    try {
      const { chatId } = payload || {};
      if (!chatId) return;
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      const isParticipant = chat.participants.some((p) => p.toString() === userId);
      if (!isParticipant) return;
      const receiverId = chat.participants.find((p) => p.toString() !== userId);
      io.to(`user:${receiverId}`).emit('typing:start', { chatId, userId });
    } catch (err) {
      console.error('typing:start error:', err);
    }
  });

  socket.on('typing:stop', async (payload) => {
    try {
      const { chatId } = payload || {};
      if (!chatId) return;
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      const isParticipant = chat.participants.some((p) => p.toString() === userId);
      if (!isParticipant) return;
      const receiverId = chat.participants.find((p) => p.toString() !== userId);
      io.to(`user:${receiverId}`).emit('typing:stop', { chatId, userId });
    } catch (err) {
      console.error('typing:stop error:', err);
    }
  });
}

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
    viewMode: msg.viewMode,
    viewDuration: msg.viewDuration,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}
