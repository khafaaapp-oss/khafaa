import { AdminLog } from '../models/AdminLog.js';

/**
 * Writes an admin action to the audit log.
 * Never throws — logging failures must not break the main action.
 */
export async function logAdminAction({
  adminId,
  action,
  targetType = 'other',
  targetId = null,
  metadata = {},
  req = null,
}) {
  try {
    await AdminLog.create({
      adminId,
      action,
      targetType,
      targetId,
      metadata,
      ip: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
    });
  } catch (err) {
    console.error('Failed to write admin log:', err.message);
  }
}
