import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { workspaceApi } from '../lib/endpoints.js';
import { useAuth } from './AuthContext.jsx';

const WorkspaceContext = createContext(null);
const KEY = 'devflow:workspace';

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [storedId, setStoredId] = useState(() => {
    try { return localStorage.getItem(`${KEY}:${user?.id}`); } catch { return null; }
  });

  const refresh = useCallback(async () => {
    try {
      const data = await workspaceApi.list();
      setWorkspaces(data.workspaces);
      setStatus('ready');
      setError(null);
      return data.workspaces;
    } catch (e) {
      setError(e);
      setStatus('error');
      return [];
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selectWorkspace = useCallback((id) => {
    setStoredId(String(id));
    try { localStorage.setItem(`${KEY}:${user?.id}`, String(id)); } catch { /* ignore */ }
  }, [user?.id]);

  const current = useMemo(
    () => workspaces.find((w) => w.id === storedId) ?? workspaces[0] ?? null,
    [workspaces, storedId],
  );

  const value = useMemo(
    () => ({ workspaces, current, status, error, refresh, selectWorkspace }),
    [workspaces, current, status, error, refresh, selectWorkspace],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspaces = () => useContext(WorkspaceContext);
