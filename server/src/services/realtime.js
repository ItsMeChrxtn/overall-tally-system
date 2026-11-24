import { Server } from 'socket.io';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { verifyToken } from '../utils/token.js';

let io = null;

/** Attaches Socket.IO to the HTTP server. Clients authenticate with their JWT and join event rooms after an access check. */
export function initRealtime(httpServer, { canAccessEvent }) {
  io = new Server(httpServer, { cors: { origin: env.clientUrls, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub).select('+tokenVersion');
      if (!user || user.status !== 'active' || (user.tokenVersion || 0) !== (payload.tv || 0)) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user._id}`);

    socket.on('event:join', async (eventId, ack) => {
      try {
        const ok = await canAccessEvent(socket.user, eventId);
        if (ok) socket.join(`event:${eventId}`);
        if (typeof ack === 'function') ack({ ok });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    });
    socket.on('event:leave', (eventId) => socket.leave(`event:${eventId}`));
  });

  return io;
}

/** Broadcasts to staff watching an event (admins / tabulators / judges that joined the room). */
export function emitToEvent(eventId, type, payload = {}) {
  if (io) io.to(`event:${eventId}`).emit(type, { eventId: String(eventId), ...payload });
}

export function emitToUser(userId, type, payload = {}) {
  if (io) io.to(`user:${userId}`).emit(type, payload);
}
