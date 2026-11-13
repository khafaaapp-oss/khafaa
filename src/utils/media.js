import path from 'node:path';
import fs from 'node:fs';
import { UPLOAD_DIR } from './upload.js';

/**
 * Resolves the absolute path of a media file for a given message.
 * The message.content stores a relative path like "uploads/abc.jpg"
 * or just "abc.jpg" (filename). We normalize it here.
 */
export function resolveMediaPath(content) {
  if (!content) return null;

  // If content already includes "uploads/", strip it
  const base = path.basename(content);
  const full = path.join(UPLOAD_DIR, base);

  if (!fs.existsSync(full)) return null;
  return full;
}

/**
 * Determines the MIME type from a file extension.
 */
export function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.txt': 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Checks whether a user (or admin) may view this message's media.
 * Returns { allowed: true } or { allowed: false, reason }.
 *
 * Rules:
 *  - Banned users: no.
 *  - Admin: always allowed, and does NOT consume a view.
 *  - Normal user:
 *      * Must be sender or receiver.
 *      * If viewMode === 'once': if user already viewed → denied.
 *      * If viewMode === 'timed': same as 'once' for repeat visits,
 *        but the first view is timed on the client.
 */
export function canViewMessageMedia(message, user) {
  if (!user) return { allowed: false, reason: 'Not authenticated' };
  if (user.isBanned) return { allowed: false, reason: 'Account banned' };

  const isAdmin = user.role === 'admin';
  const userId = user._id.toString();
  const isSender = message.senderId.toString() === userId;
  const isReceiver = message.receiverId.toString() === userId;

  if (isAdmin) return { allowed: true, consumeView: false };

  if (!isSender && !isReceiver) {
    return { allowed: false, reason: 'Not a participant' };
  }

  // Sender always sees their own media (no view consumption)
  if (isSender) return { allowed: true, consumeView: false };

  // Receiver: check view-once / timed
  if (message.viewMode === 'once' || message.viewMode === 'timed') {
    if (message.viewedBy && message.viewedBy.toString() === userId) {
      return { allowed: false, reason: 'Already viewed' };
    }
    return { allowed: true, consumeView: true };
  }

  return { allowed: true, consumeView: false };
}
