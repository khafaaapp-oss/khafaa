import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { Chat } from '../models/Chat.js';

/**
 * Registers chat-related socket events for a connected socket.
 */
export function registerChatHandlers(io, socket) {
  const userId = socket.userId;

  // ── Send message ──────────────────────────────────
  socket.on('message:send', async (payload, ack) => {
    try {
      const { chatId, content, type = 'text', viewMode = 'normal', viewDuration = null, metadata = {} } = payload || {};

      if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        return ack?.({ error: 'Invalid chatId' });
      }
      if (type === 'text' && (!content || !content.trim())) {
        return ack?.({ error: 'Message content is required' });
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
        content: content || '',
        metadata,
        viewMode,
        viewDuration,
      });

      // Update chat lastMessage + unread counter
      chat.lastMessage = {
        messageId: message._id,
        preview: (content || `[${type}]`).slice(0, 100),
        type,
        senderId: userId,
        at: message.createdAt,
      };
      const currentUnread = chat.unreadCounts.get(receiverId.toString()) || 0;
      chat.unreadCounts.set(receiverId.toString(), currentUnread + 1);
      await chat.save();

      const serialized = serializeMessage(message);

      // Deliver to receiver and sender (for multi-device sync)
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

      // Notify the sender that their message was read
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

      // Update chat.lastMessage if needed
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

      // Silent: notify both parties to remove from UI
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
      io.to(`user:${receiverId}`).emit('typing:start', {
        chatId,
        userId,
      });
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
      io.to(`user:${receiverId}`).emit('typing:stop', {
        chatId,
        userId,
      });
    } catch (err) {
      console.error('typing:stop error:', err);
    }
  });
}

// ── Serializer (consistent with REST) ───────────────
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
