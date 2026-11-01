import { useOutletContext } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { projectApi } from '../../lib/endpoints.js';
import { ActivityFeed } from '../../components/ActivityFeed.jsx';
import { useWorkspace } from '../../layouts/WorkspaceScope.jsx';
import { Card, EmptyState, ErrorState, Pagination, SkeletonRows } from '../../components/ui/index.js';

export function ProjectActivityView() {
  const { project, members, refreshKey } = useOutletContext();
  const { workspace } = useWorkspace();
  const { values, set } = useListParams({ page: 1 });
  const { data, error, loading, refreshing, reload } = useFetch(
    (signal) => projectApi.activity(project.id, { page: values.page, limit: 20 }, { signal }),
    [project.id, values.page, refreshKey],
  );
  const nameOf = (id) => members.find((m) => m.id === String(id))?.displayName ?? 'a teammate';

  return (
    <Card>
      <div aria-busy={loading} className={refreshing ? 'opacity-60 transition-opacity' : ''}>
        {loading && !data ? <SkeletonRows rows={6} />
          : error && !data ? <ErrorState error={error} title="Couldn’t load activity" onRetry={reload} />
          : data.activity.length === 0 ? <EmptyState icon="clock" title="No activity yet" description="Changes to this project and its tasks are recorded here." />
          : <ActivityFeed entries={data.activity} workspaceId={workspace.id} nameOf={nameOf} showProject={false} />}
      </div>
      <Pagination pagination={data?.pagination} onPage={(page) => set({ page })} noun="events" disabled={loading} />
    </Card>
  );
}
