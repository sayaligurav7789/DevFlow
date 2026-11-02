import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { workspaceApi } from '../lib/endpoints.js';
import { slugify } from '../lib/format.js';
import { ROLE_LABELS } from '../lib/constants.js';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Icon, Input, Notice, PageHeader, PageLoader, Textarea } from '../components/ui/index.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function CreateWorkspaceDialog({ open, onClose }) {
  const { refresh, selectWorkspace } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm({ name: '', slug: '', description: '' }); setSlugTouched(false); setErrors({}); setFormError(''); }
  }, [open]);

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    const name = form.name.trim();
    if (name.length < 1 || name.length > 80) next.name = 'Use 1–80 characters.';
    if (form.slug && !SLUG.test(form.slug)) next.slug = 'Lowercase letters, numbers, and single hyphens only.';
    if (form.description.length > 1000) next.description = 'At most 1000 characters.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const { workspace } = await workspaceApi.create({ name, slug: form.slug || undefined, description: form.description.trim() });
      await refresh();
      selectWorkspace(workspace.id);
      toast.success(`Workspace “${workspace.name}” created`);
      onClose();
      navigate(`/workspaces/${workspace.id}`);
    } catch (error) {
      if (error.status === 409) setErrors({ slug: error.message });
      else setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Create workspace"
      description="A workspace holds your team, projects, and tasks."
      footer={(<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="create-workspace" loading={busy}>Create workspace</Button></>)}
    >
      <form id="create-workspace" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} maxLength={80} value={form.name} placeholder="Acme Engineering" onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })} />}
        </Field>
        <Field label="URL slug" error={errors.slug} hint="Unique identifier. Generated from the name by default.">
          {(p) => <Input {...p} maxLength={60} value={form.slug} onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value.toLowerCase() }); }} />}
        </Field>
        <Field label="Description" optional error={errors.description}>
          {(p) => <Textarea {...p} rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
      </form>
    </Dialog>
  );
}

function WorkspaceFeature({ icon, title, description, detail }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-strong">
      <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg">
        <Icon name={icon} className="size-[18px]" />
      </div>
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-5 text-muted">{description}</p>
      <p className="mt-3 border-t border-line pt-2.5 text-[11px] font-medium text-faint">{detail}</p>
    </div>
  );
}

function FirstWorkspaceWelcome({ onCreate }) {
  const { user } = useAuth();
  const firstName = user?.displayName?.trim()?.split(/\s+/)[0] || 'there';

  return (
    <div className="space-y-6">
      <div className="relative isolate overflow-hidden rounded-2xl border border-line bg-panel">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 -z-10 size-80 rounded-full bg-accent/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 -z-10 size-72 rounded-full bg-accent/5 blur-3xl" />
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:p-10">
          <div className="max-w-xl">
            <Badge tone="accent">YOUR WORKSPACE STARTS HERE</Badge>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">Good to have you here, {firstName}.</h1>
            <p className="mt-3 max-w-lg text-[14px] leading-6 text-muted">Bring your team, projects, and everyday work into one organised place. Create your first workspace to get started with DevFlow.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button variant="primary" icon="plus" onClick={onCreate}>Create your workspace</Button>
              <span className="text-[11.5px] text-faint">It only takes a minute</span>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted">
              <span className="inline-flex items-center gap-1.5"><Icon name="check" className="size-3.5 text-accent" />Projects & tasks</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="check" className="size-3.5 text-accent" />Team collaboration</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="check" className="size-3.5 text-accent" />Progress tracking</span>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm rounded-xl border border-line-strong bg-canvas/80 p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <p className="text-[11px] font-medium text-faint">WORKSPACE PREVIEW</p>
                <p className="mt-1 text-[13px] font-semibold text-fg">Your team hub</p>
              </div>
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon name="folder" className="size-4" /></span>
            </div>
            <div className="space-y-2.5 py-4">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-raised text-muted"><Icon name="folder" /></span>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-fg">Projects</p><p className="text-[11px] text-faint">Plan work and milestones</p></div>
                <Badge>01</Badge>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-raised text-muted"><Icon name="tasks" /></span>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-fg">Tasks</p><p className="text-[11px] text-faint">Keep work moving forward</p></div>
                <Badge>02</Badge>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-raised text-muted"><Icon name="users" /></span>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-fg">Your team</p><p className="text-[11px] text-faint">Bring everyone together</p></div>
                <Badge>03</Badge>
              </div>
            </div>
            <p className="text-center text-[10.5px] text-faint">A clearer way to work, together.</p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><h2 className="text-[15px] font-semibold text-fg">Everything you need to work better</h2><p className="mt-1 text-[12.5px] text-muted">Your workspace brings these tools together.</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WorkspaceFeature icon="folder" title="Project management" description="Organise projects, milestones, and work in progress." detail="PLAN AND TRACK" />
          <WorkspaceFeature icon="tasks" title="Task management" description="Assign owners, set priorities, and follow deadlines." detail="STAY ON TOP OF WORK" />
          <WorkspaceFeature icon="message" title="Team collaboration" description="Share updates, discuss ideas, and keep everyone aligned." detail="WORK AS A TEAM" />
          <WorkspaceFeature icon="clock" title="Activity & insights" description="See recent activity and understand project progress." detail="SEE THE BIG PICTURE" />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-4 sm:p-5">
        <h2 className="text-[13px] font-semibold text-fg">Get started in three simple steps</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['01', 'Create a workspace', 'Give your team a shared home.'],
            ['02', 'Invite your teammates', 'Bring collaborators into your workspace.'],
            ['03', 'Create your first project', 'Break your goals into manageable tasks.'],
          ].map(([number, title, description]) => (
            <div key={number} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-[11px] font-semibold text-muted">{number}</span>
              <div><p className="text-[12.5px] font-medium text-fg">{title}</p><p className="mt-1 text-[11.5px] leading-5 text-muted">{description}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspacesPage() {
  const { workspaces, status, error, refresh, current, selectWorkspace } = useWorkspaces();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');

  function closeCreate() {
    setCreating(false);
    if (params.has('new')) setParams({}, { replace: true });
  }

  if (status === 'loading') return <PageLoader label="Loading workspaces" />;
  if (status === 'error') return <ErrorState error={error} title="Couldn't load your workspaces" onRetry={refresh} />;

  return (
    <>
      {workspaces.length === 0 ? (
        <FirstWorkspaceWelcome onCreate={() => setCreating(true)} />
      ) : (
        <>
          <PageHeader
            title="Workspaces"
            description="Switch between teams or start a new workspace."
            actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New workspace</Button>}
          />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  to={`/workspaces/${w.id}`}
                  onClick={() => selectWorkspace(w.id)}
                  className="group flex h-full flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-line-strong hover:bg-raised"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-[14px] font-semibold">{w.name.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-fg">{w.name}</p>
                      <p className="truncate text-[12.5px] text-faint">{w.slug}</p>
                    </div>
                    {w.id === current?.id && <Badge tone="accent">Current</Badge>}
                  </div>
                  {w.description && <p className="mt-3 line-clamp-2 text-[13px] text-muted">{w.description}</p>}
                  <div className="mt-auto flex items-center gap-3 pt-4 text-[12.5px] text-muted">
                    <span className="inline-flex items-center gap-1.5"><Icon name="users" className="size-3.5" />{w.memberCount} {w.memberCount === 1 ? 'member' : 'members'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ROLE_LABELS[w.role]}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <CreateWorkspaceDialog open={creating} onClose={closeCreate} />
    </>
  );
}
