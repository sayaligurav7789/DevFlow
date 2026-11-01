import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
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
      <PageHeader
        title="Workspaces"
        description="Switch between teams or start a new workspace."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New workspace</Button>}
      />
      {workspaces.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder"
            title="Create your first workspace"
            description="Workspaces organise projects and teammates. You can also join one by accepting an invitation link."
            action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create workspace</Button>}
          />
        </Card>
      ) : (
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
      )}
      <CreateWorkspaceDialog open={creating} onClose={closeCreate} />
    </>
  );
}
