import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/localClient';

export function useCurrentUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
    // Poll every 10s so block status reflects quickly
    const interval = setInterval(fetchUser, 10000);
    return () => clearInterval(interval);
  }, [fetchUser]);

  const isAdmin = user?.role === 'admin';
  // Treat 'client' and legacy 'user' roles as clients
  const isClient = user?.role !== 'admin';

  return { user, loading, isAdmin, isClient, refreshUser: fetchUser };
}
