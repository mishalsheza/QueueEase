// lib/realtime.ts: hooks for live updates over the shared socket.
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/socket';

/** What the server sends when a queue changes (no user ids or names). */
export type QueueUpdate = {
  queueId: string;
  reason: 'created' | 'joined' | 'left' | 'called' | 'served' | 'no_show' | 'paused' | 'resumed' | 'settings' | 'closed';
  status: 'open' | 'paused' | 'closed';
  waitingCount: number;
  nowServing: string | null;
  nextToken: string | null;
};

/** Sent only to the user call-next picked, on all their devices. */
export type TicketCalled = { queueId: string; queueName: string; token: string; calledAt: string };

/**
 * Runs `handler` for a socket event while the component is mounted. The
 * listener is removed on unmount, and the latest handler is always used, so
 * re-renders never add a second listener (the old admin dashboard leak).
 */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}

/** true while the socket is connected. */
export function useSocketConnected() {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    setConnected(socket.connected);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
    };
  }, []);
  return connected;
}

// ---- Queue rooms, shared between screens ----
// Tabs stay mounted together, so two screens may watch the same queue. A
// count per queue makes sure one screen leaving doesn't unsubscribe the other.
const roomCounts = new Map<string, number>();

const subscribeRoom = (id: string) => {
  const n = roomCounts.get(id) ?? 0;
  roomCounts.set(id, n + 1);
  if (n === 0 && socket.connected) socket.emit('queue:subscribe', id);
};

const unsubscribeRoom = (id: string) => {
  const n = roomCounts.get(id) ?? 0;
  if (n <= 1) {
    roomCounts.delete(id);
    if (socket.connected) socket.emit('queue:unsubscribe', id);
  } else {
    roomCounts.set(id, n - 1);
  }
};

// Rooms don't survive a reconnect (or a new login): join them again.
socket.on('connect', () => {
  roomCounts.forEach((_n, id) => socket.emit('queue:subscribe', id));
});

/** Watches these queues' rooms while mounted. The server checks entitlement. */
export function useQueueRooms(queueIds: string[]) {
  const key = [...new Set(queueIds.filter(Boolean))].sort().join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    ids.forEach(subscribeRoom);
    return () => ids.forEach(unsubscribeRoom);
  }, [key]);
}

/** Collapses bursts of events (e.g. several joins at once) into one call. */
export function useCoalesced(fn: () => void, ms = 300) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), ms);
  }, [ms]);
}
