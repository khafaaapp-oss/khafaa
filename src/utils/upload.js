import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const UPLOAD_DIR = path.resolve('uploads');

// Ensure uploads/ exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Allowed MIME types & size limits ─────────────────
const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'],
  file: [
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ],
};

const MAX_SIZE_BYTES = {
  image: 10 * 1024 * 1024, // 10 MB
  video: 50 * 1024 * 1024, // 50 MB
  audio: 20 * 1024 * 1024, // 20 MB
  file: 25 * 1024 * 1024, // 25 MB
};

// ── Storage ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex');
    cb(null, `${name}${ext}`);
  },
});

// ── File filter ──────────────────────────────────────
function fileFilter(req, file, cb) {
  const kind = req.params.kind || 'file';
  const allowed = ALLOWED[kind] || ALLOWED.file;
  if (!allowed.includes(file.mimetype)) {
    const err = new Error(`File type ${file.mimetype} not allowed for ${kind}`);
    err.status = 400;
    return cb(err);
  }
  cb(null, true);
}

// ── Export a builder that knows size limits per kind ─
export function buildUploader(kind) {
  const maxSize = MAX_SIZE_BYTES[kind] || MAX_SIZE_BYTES.file;
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: maxSize },
  }).single('file');
}

export { UPLOAD_DIR };
