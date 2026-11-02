import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { useListParams } from '../hooks/useListParams.js';
import { useMembers } from '../hooks/useMembers.js';
import { workspaceApi } from '../lib/endpoints.js';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import { Button, Card, EmptyState, ErrorState, FilterSelect, Icon, Pagination, SkeletonRows } from '../components/ui/index.js';

const DEFAULTS = { entityType: '', actorId: '', page: 1 };

export function ActivityPage() {
  const { workspace } = useWorkspace();
  const { members } = useMembers(workspace.id);
  const { values, set, clear, activeFilterCount } = useListParams(DEFAULTS);
  const { data, error, loading, refreshing, reload } = useFetch(
    (signal) => workspaceApi.activity(workspace.id, { entityType: values.entityType, actorId: values.actorId, page: values.page, limit: 25 }, { signal }),
    [workspace.id, values.entityType, values.actorId, values.page],
  );
  const nameOf = (id) => members.find((m) => m.id === String(id))?.displayName ?? 'a teammate';

  return (
    <>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon name="clock" className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Activity</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          Everything that changed in {workspace.name}, newest first.
        </p>
      </header>
      <Card>
        <div role="search" aria-label="Filter activity" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <FilterSelect label="Filter by type" value={values.entityType} onChange={(v) => set({ entityType: v })}>
            <option value="">Tasks and projects</option>
            <option value="task">Tasks only</option>
            <option value="project">Projects only</option>
          </FilterSelect>
          <FilterSelect label="Filter by person" value={values.actorId} onChange={(v) => set({ actorId: v })}>
            <option value="">Everyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </FilterSelect>
          {activeFilterCount > 0 && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
        </div>
        <div aria-busy={loading} className={refreshing ? 'opacity-60 transition-opacity' : ''}>
          {loading && !data ? <SkeletonRows rows={8} />
            : error && !data ? <ErrorState error={error} title="Couldn’t load activity" onRetry={reload} />
            : data.activity.length === 0 ? (
              activeFilterCount > 0
                ? <EmptyState icon="search" title="No activity matches these filters" action={<Button onClick={clear}>Clear filters</Button>} />
                : <EmptyState icon="clock" title="No activity yet" description="Changes to projects and tasks are recorded here." />
            ) : <ActivityFeed entries={data.activity} workspaceId={workspace.id} nameOf={nameOf} />}
        </div>
        <Pagination pagination={data?.pagination} onPage={(page) => set({ page })} noun="events" disabled={loading} />
      </Card>
    </>
  );
}
