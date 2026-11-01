
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '../context/ToastContext.jsx';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { workspaceApi } from '../lib/endpoints.js';

import {
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Notice,
  PageHeader,
  Switch,
  Textarea,
} from '../components/ui/index.js';

function SettingsSectionHeader({ number, title, description }) {
  return (
    <div className="flex items-start gap-4 border-b border-line px-6 py-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold text-accent">
        {number}
      </div>

      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

export function WorkspaceSettingsPage() {
  const { workspace, canManage, isOwner } = useWorkspace();
  const { refresh } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: workspace.name,
    description: workspace.description ?? '',
  });

  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const [switchBusy, setSwitchBusy] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: workspace.name,
      description: workspace.description ?? '',
    });
  }, [workspace.id, workspace.name, workspace.description]);

  const dirty =
    form.name.trim() !== workspace.name ||
    form.description.trim() !== (workspace.description ?? '');

  async function save(event) {
    event.preventDefault();

    const next = {};

    if (!form.name.trim() || form.name.trim().length > 80) {
      next.name = 'Use 1–80 characters.';
    }

    if (form.description.length > 1000) {
      next.description = 'At most 1000 characters.';
    }

    setErrors(next);
    setFormError('');

    if (Object.keys(next).length) return;

    setBusy(true);

    try {
      await workspaceApi.update(workspace.id, {
        name: form.name.trim(),
        description: form.description.trim(),
      });

      await refresh();
      toast.success('Workspace updated');
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleInvites(value) {
    setSwitchBusy(true);

    try {
      await workspaceApi.update(workspace.id, {
        settings: {
          allowMemberInvites: value,
        },
      });

      await refresh();

      toast.success(
        value
          ? 'Members can now invite teammates'
          : 'Only owners and admins can invite teammates'
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSwitchBusy(false);
    }
  }

  async function remove() {
    setDeleteBusy(true);
    setDeleteError('');

    try {
      await workspaceApi.remove(workspace.id);

      const remaining = await refresh();

      toast.success(`Workspace “${workspace.name}” deleted`);

      navigate(
        remaining.length
          ? `/workspaces/${remaining[0].id}`
          : '/workspaces',
        { replace: true }
      );
    } catch (e) {
      setDeleteError(e.message);
      setDeleteBusy(false);
    }
  }

  return (
    <>
      {/* Page heading */}
      <PageHeader
        title="Workspace settings"
        description={`Manage ${workspace.name} and control how your team collaborates.`}
      />

      {!canManage && (
        <Notice tone="info" className="mb-5">
          Only workspace owners and admins can change these settings.
        </Notice>
      )}

      {/* FULL-WIDTH SETTINGS CONTENT */}
      <div className="w-full space-y-6 pb-10">

        {/* GENERAL INFORMATION */}
        <Card className="w-full overflow-hidden">
          <SettingsSectionHeader
            number="01"
            title="General information"
            description="Manage your workspace identity and details."
          />

          <div className="p-6">
            {/* Workspace identity */}
            <div className="mb-6 flex items-center gap-4 rounded-xl border border-line bg-raised p-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-xl font-bold text-accent">
                {workspace.name?.charAt(0)?.toUpperCase() || 'W'}
              </div>

              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-fg">
                  {workspace.name}
                </h3>

                <p className="mt-1 truncate text-xs text-muted">
                  Workspace · {workspace.slug}
                </p>
              </div>
            </div>

            <div className="mb-5">
              <h3 className="text-sm font-semibold text-fg">
                Workspace details
              </h3>

              <p className="mt-1 text-xs text-muted">
                Update the information displayed to workspace members.
              </p>
            </div>

            <form onSubmit={save} noValidate className="space-y-5">
              {formError && (
                <Notice tone="error">
                  {formError}
                </Notice>
              )}

              <Field label="Workspace name" error={errors.name}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={80}
                    disabled={!canManage}
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="Enter workspace name"
                  />
                )}
              </Field>

              <Field
                label="Workspace slug"
                hint="The slug is generated when the workspace is created and cannot be changed."
              >
                {(p) => (
                  <Input
                    {...p}
                    disabled
                    value={workspace.slug}
                    readOnly
                  />
                )}
              </Field>

              <Field
                label="Description"
                optional
                error={errors.description}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={4}
                    maxLength={1000}
                    disabled={!canManage}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Describe what this workspace is used for..."
                  />
                )}
              </Field>

              <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
                <p className="text-xs text-muted">
                  {form.description.length}/1000 characters
                </p>

                {canManage && (
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={!dirty || busy}
                  >
                    Save changes
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Card>

        {/* TEAM PERMISSIONS */}
        <Card className="w-full overflow-hidden">
          <SettingsSectionHeader
            number="02"
            title="Team permissions"
            description="Control how members collaborate and invite others."
          />

          <div className="p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-fg">
                  Member invitations
                </h3>

                <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
                  Allow workspace members to invite teammates into this
                  workspace. Only the owner can change this permission.
                </p>

                <div className="mt-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      workspace.settings?.allowMemberInvites === true
                        ? 'bg-success-soft text-success'
                        : 'bg-raised text-muted'
                    }`}
                  >
                    {workspace.settings?.allowMemberInvites === true
                      ? 'Invitations enabled'
                      : 'Invitations restricted'}
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <Switch
                  label="Let members invite teammates"
                  description={
                    isOwner
                      ? 'Members can invite others as members. Only you can invite admins.'
                      : 'Only the workspace owner can change this setting.'
                  }
                  checked={
                    workspace.settings?.allowMemberInvites === true
                  }
                  onChange={toggleInvites}
                  disabled={!isOwner || switchBusy}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* DANGER ZONE */}
        {isOwner && (
          <Card className="w-full overflow-hidden border border-danger/30">
            <SettingsSectionHeader
              number="03"
              title="Danger zone"
              description="Irreversible actions that affect your entire workspace."
            />

            <div className="p-6">
              <div className="flex flex-col gap-4 rounded-xl border border-danger/20 bg-danger/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">
                    Delete this workspace
                  </h3>

                  <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
                    Permanently removes this workspace, including its
                    projects, tasks, and memberships. This action cannot
                    be undone.
                  </p>
                </div>

                <Button
                  variant="danger"
                  onClick={() => {
                    setTyped('');
                    setDeleteError('');
                    setDeleting(true);
                  }}
                >
                  Delete workspace
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* DELETE CONFIRMATION DIALOG */}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        busy={deleteBusy}
        size="sm"
        title="Delete workspace?"
        description="This permanently deletes everything in the workspace and cannot be undone."
        footer={
          <>
            <Button
              onClick={() => setDeleting(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>

            <Button
              variant="danger"
              loading={deleteBusy}
              disabled={typed !== workspace.name}
              onClick={remove}
            >
              Delete workspace
            </Button>
          </>
        }
      >
        {deleteError && (
          <Notice tone="error" className="mb-3">
            {deleteError}
          </Notice>
        )}

        <Field label={`Type “${workspace.name}” to confirm`}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Enter workspace name"
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}
