import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { useListParams } from '../hooks/useListParams.js';
import { projectApi } from '../lib/endpoints.js';
import { timeAgo } from '../lib/format.js';
import { Badge, Button, Card, EmptyState, ErrorState, FilterSelect, Icon, Pagination, SearchInput, SkeletonRows } from '../components/ui/index.js';
import { ProjectDialog } from '../components/projects/ProjectDialog.jsx';

const DEFAULTS = { q: '', archived: 'false', sortBy: 'updatedAt', sortOrder: 'desc', page: 1 };
const SORTS = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'createdAt:desc', label: 'Newest' },
  { value: 'name:asc', label: 'Name (A → Z)' },
  { value: 'name:desc', label: 'Name (Z → A)' },
];

export function ProjectsPage() {
  const { workspace, canManage } = useWorkspace();
  const navigate = useNavigate();
  const { values, set, clear, activeFilterCount } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(false);

  const { data, error, loading, refreshing, reload } = useFetch(
    (signal) => projectApi.list(workspace.id, { q: values.q, archived: values.archived, sortBy: values.sortBy, sortOrder: values.sortOrder, page: values.page, limit: 15 }, { signal }),
    [workspace.id, values.q, values.archived, values.sortBy, values.sortOrder, values.page],
  );

  const projects = data?.projects ?? [];
  const isArchivedView = values.archived === 'true';
  const filtered = Boolean(values.q);

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="folder" className="size-5" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Projects</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            Everything your team is working on in {workspace.name}.
          </p>
        </div>

        {canManage && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </header>
      <Card>
        <div role="search" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div role="tablist" aria-label="Project state" className="flex rounded-md border border-line-strong p-0.5">
            {[['false', 'Active'], ['true', 'Archived']].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={values.archived === value}
                onClick={() => set({ archived: value })}
                className={`h-6 rounded px-2.5 text-[12.5px] font-medium ${values.archived === value ? 'bg-active text-fg' : 'text-muted hover:text-fg'}`}
              >{label}</button>
            ))}
          </div>
          <SearchInput value={values.q} onChange={(q) => set({ q })} placeholder="Search projects" label="Search projects" className="w-full sm:w-60" />
          <FilterSelect label="Sort projects" className="sm:ml-auto" value={`${values.sortBy}:${values.sortOrder}`} onChange={(v) => { const [sortBy, sortOrder] = v.split(':'); set({ sortBy, sortOrder }); }}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </FilterSelect>
          {filtered && <Button size="sm" variant="ghost" onClick={clear}>Clear search</Button>}
        </div>

        <div aria-busy={loading} className={refreshing ? 'opacity-60 transition-opacity' : ''}>
          {loading && !data ? <SkeletonRows rows={5} />
            : error && !data ? <ErrorState error={error} title="Couldn't load projects" onRetry={reload} />
            : projects.length === 0 ? (
              filtered ? (
                <EmptyState icon="search" title="No projects match your search" description={`Nothing matched “${values.q}”. Try a different term.`} action={<Button onClick={clear}>Clear search</Button>} />
              ) : isArchivedView ? (
                <EmptyState icon="archive" title="No archived projects" description="Projects you archive will be kept here, read-only." />
              ) : (
                <EmptyState
                  icon="folder"
                  title="No projects yet"
                  description={canManage ? 'Create a project to start tracking tasks.' : 'Workspace owners and admins can create projects. Ask one to set up the first project.'}
                  action={canManage && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New project</Button>}
                />
              )
            ) : (
              <ul className="divide-y divide-line">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/workspaces/${workspace.id}/projects/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-faint"><Icon name="folder" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-fg">{p.name}</span>
                          {p.archived && <Badge>Archived</Badge>}
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted">{p.description || <span className="text-faint">No description</span>}</span>
                      </span>
                      <span className="hidden shrink-0 text-[12.5px] text-faint sm:block">Updated {timeAgo(p.updatedAt)}</span>
                      <Icon name="chevronRight" className="size-3.5 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <Pagination pagination={data?.pagination} onPage={(page) => set({ page })} noun="projects" disabled={loading} />
      </Card>

      <ProjectDialog open={creating} onClose={() => setCreating(false)} workspaceId={workspace.id} onSaved={(p) => navigate(`/workspaces/${workspace.id}/projects/${p.id}`)} />
    </>
  );
}
