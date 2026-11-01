import { useEffect, useState } from 'react';
import { taskApi } from '../../lib/endpoints.js';
import { PRIORITIES, STATUSES, isManager } from '../../lib/constants.js';
import { toDateInput } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, ConfirmDialog, Dialog, Field, Input, Label, Notice, Select, Textarea } from '../ui/index.js';
import { ActivityList } from './ActivityList.jsx';

function LabelsInput({ labels, onChange, invalid, disabled, ...aria }) {
  const [draft, setDraft] = useState('');
  function commit() {
    const value = draft.trim();
    if (value && value.length <= 40 && !labels.includes(value) && labels.length < 20) onChange([...labels, value]);
    setDraft('');
  }
  return (
    <div className={`rounded-md border bg-panel px-2 py-1.5 ${invalid ? 'border-danger' : 'border-line-strong focus-within:border-accent'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((l) => <Label key={l} onRemove={disabled ? undefined : () => onChange(labels.filter((x) => x !== l))}>{l}</Label>)}
        {!disabled && (
          <input
            {...aria}
            value={draft}
            maxLength={40}
            placeholder={labels.length ? '' : 'Type a label, press Enter'}
            onChange={(e) => setDraft(e.target.value.replace(',', ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
              else if (e.key === 'Backspace' && !draft && labels.length) onChange(labels.slice(0, -1));
            }}
            onBlur={commit}
            className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint focus-visible:outline-none"
          />
        )}
      </div>
    </div>
  );
}

const blank = (project, assignee = '', status = 'todo') => ({ title: '', description: '', status, priority: 'medium', assigneeId: assignee, reporterId: '', dueAt: '', labels: [], projectId: project ?? '' });
const fromTask = (t) => ({ title: t.title, description: t.description ?? '', status: t.status, priority: t.priority, assigneeId: t.assigneeId ?? '', reporterId: t.reporterId ?? '', dueAt: toDateInput(t.dueAt), labels: t.labels ?? [], projectId: t.projectId });

export function TaskDialog({ open, onClose, task, projectId, projects = [], members, workspaceRole, currentUser, projectArchived = false, defaultAssigneeId = '', defaultStatus = 'todo', onSaved }) {
  const toast = useToast();
  const editing = Boolean(task);
  const [form, setForm] = useState(blank(projectId));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [activityKey, setActivityKey] = useState(0);

  const archived = projectArchived || task?.projectArchived;
  const manager = isManager(workspaceRole);
  const canDelete = editing && !archived && (manager || task.createdById === currentUser.id || task.reporterId === currentUser.id);

  useEffect(() => {
    if (!open) return;
    setForm(task ? fromTask(task) : blank(projectId ?? projects[0]?.id, defaultAssigneeId, defaultStatus));
    setErrors({}); setFormError(''); setConfirmDelete(false); setDeleteError('');
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate() {
    const next = {};
    const title = form.title.trim();
    if (!title) next.title = 'A title is required.';
    else if (title.length > 200) next.title = 'Titles can be at most 200 characters.';
    if (form.description.length > 10000) next.description = 'Descriptions can be at most 10,000 characters.';
    if (!editing && !form.projectId) next.projectId = 'Choose a project.';
    return next;
  }

  async function onSubmit(event) {
    event.preventDefault();
    const next = validate();
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      if (!editing) {
        const { task: created } = await taskApi.create(form.projectId, {
          title: form.title.trim(),
          description: form.description.trim(),
          status: form.status,
          priority: form.priority,
          assigneeId: form.assigneeId || null,
          dueAt: form.dueAt || null,
          labels: form.labels,
        });
        toast.success('Task created');
        onSaved?.(created, 'created');
        onClose();
        return;
      }
      // PATCH only what changed so the activity log stays accurate.
      const before = fromTask(task);
      const changes = {};
      if (form.title.trim() !== before.title) changes.title = form.title.trim();
      if (form.description.trim() !== before.description.trim()) changes.description = form.description.trim();
      if (form.status !== before.status) changes.status = form.status;
      if (form.priority !== before.priority) changes.priority = form.priority;
      if (form.assigneeId !== before.assigneeId) changes.assigneeId = form.assigneeId || null;
      if (manager && form.reporterId !== before.reporterId) changes.reporterId = form.reporterId;
      if (form.dueAt !== before.dueAt) changes.dueAt = form.dueAt || null;
      if (form.labels.join('\u0000') !== before.labels.join('\u0000')) changes.labels = form.labels;
      if (!Object.keys(changes).length) { onClose(); return; }
      const { task: updated } = await taskApi.update(task.projectId, task.id, changes);
      toast.success('Task updated');
      setActivityKey((k) => k + 1);
      onSaved?.(updated, 'updated');
      onClose();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true); setDeleteError('');
    try {
      await taskApi.remove(task.projectId, task.id);
      toast.success('Task deleted');
      setConfirmDelete(false);
      onSaved?.(task, 'deleted');
      onClose();
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        busy={busy}
        size="lg"
        title={editing ? (archived ? 'Task (read-only)' : 'Edit task') : 'New task'}
        description={editing ? `${task.projectName} · created by ${task.reporterName ?? 'a former member'}` : 'Add a task to a project.'}
        footer={(
          <>
            {canDelete && <Button variant="danger-ghost" className="sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>}
            <Button onClick={onClose} disabled={busy}>{archived ? 'Close' : 'Cancel'}</Button>
            {!archived && <Button variant="primary" type="submit" form="task-form" loading={busy}>{editing ? 'Save changes' : 'Create task'}</Button>}
          </>
        )}
      >
        <form id="task-form" onSubmit={onSubmit} noValidate className="space-y-4">
          {archived && <Notice tone="warning">This project is archived. Restore it to edit its tasks.</Notice>}
          {formError && <Notice tone="error">{formError}</Notice>}

          {!editing && !projectId && (
            <Field label="Project" error={errors.projectId}>
              {(p) => (
                <Select {...p} value={form.projectId} onChange={set('projectId')}>
                  {projects.length === 0 && <option value="">No active projects</option>}
                  {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                </Select>
              )}
            </Field>
          )}

          <Field label="Title" error={errors.title}>
            {(p) => <Input {...p} data-autofocus value={form.title} maxLength={200} disabled={archived} onChange={set('title')} placeholder="What needs to be done?" />}
          </Field>
          <Field label="Description" optional error={errors.description}>
            {(p) => <Textarea {...p} rows={4} value={form.description} disabled={archived} onChange={set('description')} placeholder="Add context, links, or acceptance criteria" />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">{(p) => <Select {...p} value={form.status} disabled={archived} onChange={set('status')}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>}</Field>
            <Field label="Priority">{(p) => <Select {...p} value={form.priority} disabled={archived} onChange={set('priority')}>{PRIORITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>}</Field>
            <Field label="Assignee">
              {(p) => (
                <Select {...p} value={form.assigneeId} disabled={archived} onChange={set('assigneeId')}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.id === currentUser.id ? ' (you)' : ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Due date" optional>{(p) => <Input {...p} type="date" value={form.dueAt} disabled={archived} onChange={set('dueAt')} />}</Field>
            {editing && manager && !archived && (
              <Field label="Reporter" className="sm:col-span-2">
                {(p) => <Select {...p} value={form.reporterId} onChange={set('reporterId')}>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select>}
              </Field>
            )}
          </div>

          <Field label="Labels" optional hint={archived ? undefined : 'Up to 20 labels. Press Enter or comma to add.'}>
            {(p) => <LabelsInput labels={form.labels} onChange={(labels) => setForm((f) => ({ ...f, labels }))} disabled={archived} {...{ id: p.id, 'aria-describedby': p['aria-describedby'] }} />}
          </Field>
        </form>

        {editing && (
          <div className="mt-6 border-t border-line pt-4">
            <ActivityList projectId={task.projectId} taskId={task.id} members={members} refreshKey={activityKey} />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        busy={busy}
        error={deleteError}
        title="Delete this task?"
        description="The task and its activity history will be permanently removed. This cannot be undone."
        confirmLabel="Delete task"
      />
    </>
  );
}
