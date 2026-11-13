import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    // Public unique identifier (11 digits) — used for search & calls
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d{11}$/,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },

    // Never returned by default (select: false)
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    avatarUrl: { type: String, default: null },
    bio: { type: String, maxlength: 200, default: '' },

    // Role & moderation
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    isBanned: { type: Boolean, default: false, index: true },
    banReason: { type: String, default: null },

    // Presence
    lastSeenAt: { type: Date, default: Date.now, index: true },
    isOnline: { type: Boolean, default: false, index: true },

    // Push notifications (multiple devices per user)
    fcmTokens: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
