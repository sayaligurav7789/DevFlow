import { useMemo } from 'react';
import { workspaceApi } from '../lib/endpoints.js';
import { useFetch } from './useFetch.js';

export function useMembers(workspaceId) {
  const { data, error, loading, reload } = useFetch((signal) => workspaceApi.members(workspaceId, { signal }), [workspaceId]);
  const members = data?.members ?? [];
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  return { members, byId, error, loading, reload };
}
