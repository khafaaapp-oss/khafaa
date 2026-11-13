import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
      // Examples: ban_user, unban_user, delete_message, restore_message,
      //           delete_file, broadcast, view_user
    },
    targetType: {
      type: String,
      enum: ['user', 'message', 'chat', 'gift', 'broadcast', 'other'],
      default: 'other',
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    metadata: { type: Object, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ adminId: 1, createdAt: -1 });

export const AdminLog = mongoose.model('AdminLog', adminLogSchema);
