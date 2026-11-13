import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema(
  {
    // Exactly two participants (1-on-1 chat)
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length === 2,
        message: 'A chat must have exactly two participants',
      },
      index: true,
    },

    // Deterministic key: sorted participant ids joined by ':'
    // Guarantees (A,B) and (B,A) produce the same key.
    pairKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Cached last message (for chat list)
    lastMessage: {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
      preview: { type: String, default: '' },
      type: {
        type: String,
        enum: ['text', 'image', 'video', 'audio', 'file', 'gift'],
      },
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },

    // Unread count per user
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);


/**
 * Builds a deterministic key for a pair of user IDs.
 */
export function buildPairKey(userIdA, userIdB) {
  return [userIdA.toString(), userIdB.toString()].sort().join(':');
}

export const Chat = mongoose.model('Chat', chatSchema);
