// lib/auth.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { socket } from '@/lib/socket';
import {
  api,
  clearSession,
  loadSession,
  saveSession,
  setAuthToken,
  toSessionUser,
  type SessionUser,
} from '@/lib/api';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  /** Stores the token, asks the server who it belongs to, and signs in. */
  signIn: (token: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Asks the server for the user behind the current token. */
async function fetchMe(): Promise<SessionUser> {
  const res = await api.get('/auth/me');
  return toSessionUser(res.data?.user);
}

const isUnauthorized = (err: unknown) => isAxiosError(err) && err.response?.status === 401;

/**
 * Owns the signed-in state. The role always comes from GET /api/auth/me:
 * on app start, and right after every login or signup. The role saved on the
 * device is only used if the server can't be reached at startup.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const signOut = useCallback(async () => {
    await clearSession();
    if (socket.connected) socket.disconnect();
    setUser(null);
    setStatus('signedOut');
  }, []);

  const signIn = useCallback(async (token: string) => {
    setAuthToken(token);
    try {
      const me = await fetchMe();
      await saveSession({ token, user: me });
      setUser(me);
      setStatus('signedIn');
      return me;
    } catch (err) {
      await clearSession();
      throw err;
    }
  }, []);

  // Restore the session on app start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession();
      if (!saved.token) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      setAuthToken(saved.token);
      try {
        const me = await fetchMe();
        await saveSession({ token: saved.token, user: me });
        if (!cancelled) {
          setUser(me);
          setStatus('signedIn');
        }
      } catch (err) {
        if (cancelled) return;
        if (!isUnauthorized(err) && saved.user) {
          // Server unreachable: fall back to the last role it confirmed.
          // Every API call is still checked by the server.
          setUser(saved.user);
          setStatus('signedIn');
        } else {
          // Token rejected (expired, user deleted) or no confirmed role saved.
          await clearSession();
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If the server rejects the token later (expired, account deleted), sign out.
  useEffect(() => {
    const id = api.interceptors.response.use(undefined, async (err) => {
      if (isUnauthorized(err) && statusRef.current === 'signedIn') {
        await signOut();
      }
      return Promise.reject(err);
    });
    return () => api.interceptors.response.eject(id);
  }, [signOut]);

  const value = useMemo(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
