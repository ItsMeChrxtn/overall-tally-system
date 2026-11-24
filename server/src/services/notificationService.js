import Notification from '../models/Notification.js';
import { emitToUser } from './realtime.js';

/** Creates in-app notifications for one or more users and pushes them over Socket.IO. */
export async function notify(userIds, { title, message, link, type = 'info', event }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    const docs = await Notification.insertMany(ids.map((user) => ({ user, title, message, link, type, event })));
    for (const doc of docs) emitToUser(doc.user, 'notification', doc.toObject());
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}
