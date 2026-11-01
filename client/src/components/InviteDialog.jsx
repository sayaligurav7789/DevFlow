import { useEffect, useState } from 'react';
import { workspaceApi } from '../lib/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button,
  Dialog,
  Field,
  Icon,
  Input,
  Notice,
  Select,
} from './ui/index.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({
  open,
  onClose,
  workspaceId,
  isOwner,
  onInvited,
}) {
  const toast = useToast();

  const [form, setForm] = useState({
    email: '',
    role: 'member',
  });
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ email: '', role: 'member' });
      setError('');
      setFieldError('');
      setResult(null);
      setCopied(false);
    }
  }, [open]);

  async function onSubmit(event) {
    event.preventDefault();

    setError('');
    setFieldError('');

    const email = form.email.trim();

    if (!EMAIL.test(email)) {
      setFieldError('Enter a valid email address.');
      return;
    }

    setBusy(true);

    try {
      const data = await workspaceApi.invite(workspaceId, {
        email,
        role: form.role,
      });

      setResult(data);

      if (data.delivery === 'email') {
        toast.success(`Invitation email sent to ${data.invitation.email}`);
      } else if (data.delivery === 'failed') {
        toast.error('Invitation created, but email delivery failed.');
      } else {
        toast.success(`Invitation created for ${data.invitation.email}`);
      }

      onInvited?.();
    } catch (e) {
      if (e.status === 409 || e.status === 400) {
        setFieldError(e.message);
      } else {
        setError(e.message || 'Could not create the invitation.');
      }
    } finally {
      setBusy(false);
    }
  }

  const link = result?.developmentInvitationUrl
    ? new URL(
        result.developmentInvitationUrl,
        window.location.origin,
      ).toString()
    : '';

  async function copy() {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Invitation link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it manually.');
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={result ? 'Invitation created' : 'Invite a teammate'}
      description={
        result
          ? undefined
          : 'They’ll join this workspace when they accept the invitation.'
      }
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="invite-form"
              loading={busy}
              icon="mail"
            >
              Create invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          {result.delivery === 'email' ? (
            <Notice tone="success" title="Invitation email sent">
              {result.notice ||
                `An invitation email was sent to ${result.invitation.email}.`}
            </Notice>
          ) : result.delivery === 'failed' ? (
            <Notice tone="warning" title="Email delivery failed">
              {result.notice ||
                'The invitation was created, but the email could not be sent.'}
            </Notice>
          ) : (
            <Notice
              tone="warning"
              title="This invitation was not emailed"
            >
              {result.notice ||
                'Share the invitation link below with the invitee yourself.'}
            </Notice>
          )}

          {link && (
            <div>
              <label
                htmlFor="invite-link"
                className="mb-1.5 block text-[12.5px] font-medium"
              >
                Invitation link for {result.invitation.email}
              </label>

              <div className="flex gap-2">
                <input
                  id="invite-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.target.select()}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 font-mono text-[12px] text-muted"
                />

                <Button
                  onClick={copy}
                  icon={copied ? 'check' : 'copy'}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>

              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">
                <Icon name="clock" className="size-3" />
                Anyone with this link can join as {result.invitation.role}.
                It is shown only once.
              </p>
            </div>
          )}
        </div>
      ) : (
        <form
          id="invite-form"
          onSubmit={onSubmit}
          noValidate
          className="space-y-4"
        >
          {error && <Notice tone="error">{error}</Notice>}

          <Field label="Email address" error={fieldError}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="off"
                value={form.email}
                placeholder="teammate@company.com"
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })
                }
              />
            )}
          </Field>

          <Field
            label="Role"
            hint={
              isOwner
                ? 'Admins can manage projects and invite members.'
                : 'Only the workspace owner can invite admins.'
            }
          >
            {(p) => (
              <Select
                {...p}
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value })
                }
              >
                <option value="member">Member</option>
                {isOwner && (
                  <option value="admin">Admin</option>
                )}
              </Select>
            )}
          </Field>
        </form>
      )}
    </Dialog>
  );
}
