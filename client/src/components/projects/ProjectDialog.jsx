import { useEffect, useState } from 'react';
import { projectApi } from '../../lib/endpoints.js';
import { slugify } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Dialog, Field, Input, Notice, Textarea } from '../ui/index.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ProjectDialog({ open, onClose, workspaceId, project, onSaved }) {
  const toast = useToast();
  const editing = Boolean(project);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(project ? { name: project.name, slug: project.slug, description: project.description ?? '' } : { name: '', slug: '', description: '' });
    setSlugTouched(Boolean(project));
    setErrors({}); setFormError('');
  }, [open, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    const name = form.name.trim();
    if (!name) next.name = 'A project name is required.';
    else if (name.length > 100) next.name = 'Names can be at most 100 characters.';
    if (form.slug && (!SLUG.test(form.slug) || form.slug.length > 100)) next.slug = 'Lowercase letters, numbers, and single hyphens only.';
    if (form.description.length > 5000) next.description = 'Descriptions can be at most 5,000 characters.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const body = { name, description: form.description.trim(), ...(form.slug ? { slug: form.slug } : {}) };
      const { project: saved } = editing
        ? await projectApi.update(workspaceId, project.id, body)
        : await projectApi.create(workspaceId, body);
      toast.success(editing ? 'Project updated' : `Project “${saved.name}” created`);
      onSaved(saved, editing ? 'updated' : 'created');
      onClose();
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
      title={editing ? 'Edit project' : 'New project'}
      description={editing ? undefined : 'Projects group related tasks for your team.'}
      footer={(<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="project-form" loading={busy}>{editing ? 'Save changes' : 'Create project'}</Button></>)}
    >
      <form id="project-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} maxLength={100} value={form.name} placeholder="Website redesign" onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })} />}
        </Field>
        <Field label="Slug" error={errors.slug} hint="Unique within the workspace. Generated from the name by default.">
          {(p) => <Input {...p} maxLength={100} value={form.slug} onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value.toLowerCase() }); }} />}
        </Field>
        <Field label="Description" optional error={errors.description}>
          {(p) => <Textarea {...p} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
      </form>
    </Dialog>
  );
}
