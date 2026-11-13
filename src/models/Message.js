import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'file', 'gift'],
      default: 'text',
    },

    // Text: the message text
    // Media: relative path on the server
    content: { type: String, default: '' },

    // { mimeType, size, durationSec, width, height, fileName }
    metadata: { type: Object, default: {} },

    readAt: { type: Date, default: null },

    // ── Soft delete (performed by users) ──────────
    deletedForEveryone: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── Hard delete (performed by admin only) ─────
    permanentlyDeleted: { type: Boolean, default: false, index: true },
    permanentlyDeletedAt: { type: Date, default: null },
    permanentlyDeletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── View-once / timed media ───────────────────
    viewMode: {
      type: String,
      enum: ['normal', 'once', 'timed'],
      default: 'normal',
    },
    viewDuration: { type: Number, default: null },
    viewCount: { type: Number, default: 0 },
    viewedAt: { type: Date, default: null },
    viewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

messageSchema.index({
  chatId: 1,
  permanentlyDeleted: 1,
  deletedForEveryone: 1,
  createdAt: -1,
});

export const Message = mongoose.model('Message', messageSchema);
