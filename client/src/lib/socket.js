import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SERVER_URL, TOKEN_KEY } from '../api/client';

let socket = null;

export function connectSocket() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (socket && socket.auth?.token === token) return socket;
  if (socket) socket.disconnect();
  socket = io(SERVER_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelay: 2000 });
  return socket;
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}

/**
 * Subscribes to real-time updates for an event room.
 * handlers: { 'sheet:submitted': fn, 'result:updated': fn, ... }
 */
export function useEventSocket(eventId, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const s = connectSocket();
    if (!s || !eventId) return undefined;
    const join = () => s.emit('event:join', eventId);
    join();
    s.on('connect', join);
    const types = Object.keys(ref.current || {});
    const listeners = types.map((type) => {
      const fn = (payload) => {
        if (!payload?.eventId || payload.eventId === String(eventId)) ref.current[type]?.(payload);
      };
      s.on(type, fn);
      return [type, fn];
    });
    return () => {
      s.off('connect', join);
      listeners.forEach(([type, fn]) => s.off(type, fn));
      s.emit('event:leave', eventId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
}

/** Subscribes to a user-level socket event (e.g. notifications). */
export function useSocketEvent(type, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = connectSocket();
    if (!s) return undefined;
    const fn = (p) => ref.current?.(p);
    s.on(type, fn);
    return () => s.off(type, fn);
  }, [type]);
}
