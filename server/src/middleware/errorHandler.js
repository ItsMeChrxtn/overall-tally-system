import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong.';
  let code = err.code;
  let extra = err.extra;

  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}.`;
    code = 'INVALID_ID';
  } else if (err.name === 'ValidationError') {
    status = 400;
    const fields = Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.message]));
    message = Object.values(fields)[0] || 'Validation failed.';
    code = 'VALIDATION_ERROR';
    extra = { fields };
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || err.keyPattern || {}).join(', ');
    message = `A record with the same ${field || 'value'} already exists.`;
    code = 'DUPLICATE';
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${env.maxUploadMb} MB).` : err.message;
    code = 'UPLOAD_ERROR';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body.';
    code = 'BAD_JSON';
  }

  if (status >= 500) {
    console.error('[error]', err);
    if (env.isProd) message = 'An unexpected server error occurred.';
  }

  res.status(status).json({ success: false, message, code: code || (status >= 500 ? 'SERVER_ERROR' : 'ERROR'), ...(extra || {}) });
}
