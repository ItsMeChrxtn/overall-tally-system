import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Image-only uploader that stores files in uploads/<folder>/ with random names. */
export function imageUpload(folder) {
  const dir = path.join(UPLOAD_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[file.mimetype]}`),
    }),
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED[file.mimetype]) return cb(ApiError.badRequest('Only JPG, PNG, WEBP or GIF images are allowed.', 'UPLOAD_ERROR'));
      cb(null, true);
    },
  });
}

/** Deletes a previously uploaded file given its public path (/uploads/...). Never throws. */
export function removeUpload(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const abs = path.resolve(UPLOAD_ROOT, publicPath.replace(/^\/uploads\//, ''));
  if (!abs.startsWith(UPLOAD_ROOT)) return;
  fs.promises.unlink(abs).catch(() => {});
}
