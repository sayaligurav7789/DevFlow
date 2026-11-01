import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setUnauthorizedHandler } from '../lib/api.js';
import { authApi } from '../lib/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const userRef = useRef(null);
  userRef.current = user;

  // Any 401 from a protected endpoint means the session is gone: drop the user and let
  // RequireAuth redirect to /login with an explanatory message.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Only a signed-in user can have an "expired" session; repeated 401s are no-ops.
      if (!userRef.current) return;
      setSessionExpired(true);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((data) => active && setUser(data.user))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setSessionExpired(false);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (details) => {
    const data = await authApi.register(details);
    setSessionExpired(false);
    const current = await authApi.me().catch(() => ({ user: data.user }));
    setUser(current.user);
    return current.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSessionExpired(false);
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await authApi.me();
    setUser(data.user);
    return data.user;
  }, []);

  const updateProfile = useCallback(async (changes) => {
    const data = await authApi.updateProfile(changes);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, sessionExpired, login, register, logout, updateProfile, refreshUser }),
    [user, loading, sessionExpired, login, register, logout, updateProfile, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
