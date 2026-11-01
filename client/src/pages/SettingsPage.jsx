
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../lib/endpoints.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Field,
  Icon,
  Input,
  Notice,
  PageHeader,
} from '../components/ui/index.js';

const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun', description: 'Bright and clean' },
  { value: 'dark', label: 'Dark', icon: 'moon', description: 'Easy on the eyes' },
  { value: 'system', label: 'System', icon: 'monitor', description: 'Follow device settings' },
];

const MAX_PHOTO_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function SettingsSection({ number, title, description, children }) {
  return (
    <section className="w-full space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-semibold text-accent">
          {number}
        </span>

        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">
            {title}
          </h2>

          <p className="mt-1 text-xs text-muted">
            {description}
          </p>
        </div>
      </div>

      <div className="w-full">
        {children}
      </div>
    </section>
  );
}

function ThemeOption({ theme, selected, onClick }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`group flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all ${
        selected
          ? 'border-accent bg-accent-soft ring-1 ring-accent'
          : 'border-line bg-panel hover:border-line-strong hover:bg-raised'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span
          className={`flex size-10 items-center justify-center rounded-xl ${
            selected ? 'bg-accent text-white' : 'bg-raised text-muted'
          }`}
        >
          <Icon name={theme.icon} className="size-5" />
        </span>

        {selected && (
          <span className="flex size-5 items-center justify-center rounded-full bg-accent text-white">
            <Icon name="check" className="size-3" />
          </span>
        )}
      </div>

      <div>
        <p className="text-[13px] font-semibold text-fg">
          {theme.label}
        </p>

        <p className="mt-1 text-[11px] text-muted">
          {theme.description}
        </p>
      </div>
    </button>
  );
}

export function SettingsPage() {
  const { user, updateProfile, refreshUser, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const photoInputRef = useRef(null);

  const [form, setForm] = useState({
    displayName: user.displayName,
  });

  const [emailForm, setEmailForm] = useState({
    email: '',
    currentPassword: '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [securityBusy, setSecurityBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(
    user.avatarUrl || '/api/auth/me/photo'
  );
  const [photoFile, setPhotoFile] = useState(null);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    setForm({ displayName: user.displayName });
  }, [user.displayName]);

  useEffect(() => {
    setPhotoPreview(user.avatarUrl || '/api/auth/me/photo');
  }, [user.avatarUrl]);

  const dirty = form.displayName.trim() !== user.displayName;

  const choosePhoto = () => {
    photoInputRef.current?.click();
  };

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setPhotoError('');

    if (!ALLOWED_TYPES.includes(file.type)) {
      setPhotoError('Please select a JPG, PNG or WebP image.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_PHOTO_SIZE) {
      setPhotoError('Image size must be less than 2 MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setPhotoPreview(reader.result);
      setPhotoFile(file);
    };

    reader.onerror = () => {
      setPhotoError('Unable to read this image. Please try another.');
    };

    reader.readAsDataURL(file);
  }

  function cancelPhotoSelection() {
    setPhotoFile(null);
    setPhotoPreview(user.avatarUrl || '');
    setPhotoError('');

    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  }

  async function savePhoto() {
    if (!photoFile) return;

    setPhotoBusy(true);
    setPhotoError('');

    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read image'));

        reader.readAsDataURL(photoFile);
      });

      const result = await authApi.uploadProfilePhoto({ imageData });

      await refreshUser();

      setPhotoFile(null);
      setPhotoPreview(`/api/auth/me/photo?t=${Date.now()}`);

      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }

      toast.success(result.message || 'Profile photo updated');
    } catch (error) {
      setPhotoError(error.message || 'Unable to upload profile photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setPhotoError('');

    try {
      const result = await authApi.removeProfilePhoto();

      await refreshUser();

      setPhotoFile(null);
      setPhotoPreview('');

      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }

      toast.success(result.message || 'Profile photo removed');
    } catch (error) {
      setPhotoError(error.message || 'Unable to remove profile photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();

    const next = {};
    const name = form.displayName.trim();

    if (!name || name.length > 80) {
      next.displayName = 'Enter a name up to 80 characters.';
    }

    setErrors(next);
    setFormError('');

    if (Object.keys(next).length) return;

    const changes = {};

    if (name !== user.displayName) {
      changes.displayName = name;
    }

    if (!Object.keys(changes).length) return;

    setBusy(true);

    try {
      await updateProfile(changes);
      toast.success('Profile updated');
    } catch (e) {
      if (e.status === 409) {
        setErrors({ email: e.message });
      } else {
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setSigningOut(true);

    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(e.message);
      setSigningOut(false);
    }
  }

  async function requestEmailChange(event) {
    event.preventDefault();
    setSecurityBusy(true);

    try {
      const result = await authApi.requestEmailChange(emailForm);
      toast.success(result.message);
      setEmailForm({ email: '', currentPassword: '' });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function resendVerification() {
    try {
      const result = await authApi.resendVerification();
      toast.success(result.message);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setSecurityBusy(true);

    try {
      const result = await authApi.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      toast.success(result.message);

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSecurityBusy(false);
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);

    try {
      await authApi.signOutEverywhere();
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(e.message);
      setSigningOut(false);
    }
  }

  return (
    <div className="w-full space-y-7 pb-8">

      {/* PAGE HEADER */}
      <PageHeader
        title="Profile & settings"
        description="Manage your account, security and appearance."
      />

      {/* FULL WIDTH SETTINGS */}
      <div className="w-full space-y-7">

        {/* 01 PERSONAL INFORMATION */}
        <SettingsSection
          number="01"
          title="Personal information"
          description="Manage your profile and personal details."
        >
          <Card className="w-full overflow-hidden">
            <div className="border-b border-line bg-raised/50 p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">

                <div className="relative shrink-0">
                  <Avatar
                    name={user.displayName}
                    id={user.id}
                    src={photoPreview || user.avatarUrl}
                    size="xl"
                  />

                  <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-panel bg-success text-white">
                    <Icon name="check" className="size-3" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-semibold text-fg">
                    {user.displayName}
                  </h3>

                  <p className="mt-1 truncate text-sm text-muted">
                    {user.email}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                        user.emailVerified
                          ? 'bg-success-soft text-success'
                          : 'bg-warning-soft text-warning'
                      }`}
                    >
                      {user.emailVerified
                        ? 'Email verified'
                        : 'Email unverified'}
                    </span>

                    <span className="text-[11px] text-faint">
                      Account profile
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={choosePhoto}
                  >
                    <Icon name="camera" className="mr-1.5 size-4" />
                    {photoPreview ? 'Change photo' : 'Upload photo'}
                  </Button>

                  {user.avatarUrl && !photoFile && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={photoBusy}
                      onClick={removePhoto}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handlePhotoChange}
                />
              </div>

              <p className="mt-4 text-[11px] text-faint">
                JPG, PNG or WebP · Maximum 2 MB
              </p>

              {photoFile && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={photoBusy}
                    onClick={savePhoto}
                  >
                    Save photo
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={cancelPhotoSelection}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {photoError && (
                <div className="mt-4">
                  <Notice tone="error">{photoError}</Notice>
                </div>
              )}
            </div>

            <form onSubmit={save} noValidate className="space-y-4 p-5 sm:p-6">
              <div>
                <h3 className="text-sm font-semibold text-fg">
                  Basic information
                </h3>

                <p className="mt-1 text-xs text-muted">
                  Update the name displayed across DevFlow.
                </p>
              </div>

              {formError && <Notice tone="error">{formError}</Notice>}

              <Field label="Display name" error={errors.displayName}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={80}
                    autoComplete="name"
                    value={form.displayName}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        displayName: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <Field label="Email address">
                {() => (
                  <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 text-[13px] text-fg">
                    <span className="truncate">{user.email}</span>

                    <span
                      className={`shrink-0 text-xs ${
                        user.emailVerified ? 'text-success' : 'text-warning'
                      }`}
                    >
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                )}
              </Field>

              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!dirty}
                >
                  Save changes
                </Button>
              </div>
            </form>
          </Card>
        </SettingsSection>

        {/* 02 EMAIL AND VERIFICATION */}
        <SettingsSection
          number="02"
          title="Email & verification"
          description="Manage your email address and account verification."
        >
          <Card className="w-full overflow-hidden">
            <CardHeader
              title="Change email address"
              description="A confirmation link will be sent to your new email."
            />

            <form
              onSubmit={requestEmailChange}
              className="space-y-4 p-5 sm:p-6"
            >
              {!user.emailVerified && (
                <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Icon
                      name="shield-alert"
                      className="mt-0.5 size-5 shrink-0 text-warning"
                    />

                    <div>
                      <p className="text-sm font-medium text-fg">
                        Verify your current email
                      </p>

                      <p className="mt-1 text-xs text-muted">
                        Verify your email to help secure your account.
                      </p>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={securityBusy}
                    onClick={resendVerification}
                  >
                    Resend verification
                  </Button>
                </div>
              )}

              <Field label="New email address">
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    autoComplete="email"
                    value={emailForm.email}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        email: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <Field label="Current password">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="current-password"
                    value={emailForm.currentPassword}
                    onChange={(e) =>
                      setEmailForm({
                        ...emailForm,
                        currentPassword: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  type="submit"
                  loading={securityBusy}
                  disabled={!emailForm.email || !emailForm.currentPassword}
                >
                  Send confirmation
                </Button>
              </div>
            </form>
          </Card>
        </SettingsSection>

        {/* 03 PASSWORD AND SECURITY */}
        <SettingsSection
          number="03"
          title="Password & security"
          description="Keep your DevFlow account protected."
        >
          <Card className="w-full overflow-hidden">
            <CardHeader
              title="Change password"
              description="Use a strong password with at least 12 characters."
            />

            <form
              onSubmit={changePassword}
              className="space-y-4 p-5 sm:p-6"
            >
              <Field label="Current password">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        currentPassword: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <Field label="New password" hint="At least 12 characters.">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        newPassword: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <Field label="Confirm new password">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) =>
                      setPasswordForm({
                        ...passwordForm,
                        confirmPassword: e.target.value,
                      })
                    }
                  />
                )}
              </Field>

              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  type="submit"
                  loading={securityBusy}
                  disabled={
                    !passwordForm.currentPassword ||
                    passwordForm.newPassword.length < 12 ||
                    !passwordForm.confirmPassword
                  }
                >
                  Update password
                </Button>
              </div>
            </form>
          </Card>
        </SettingsSection>

        {/* 04 APPEARANCE */}
        <SettingsSection
          number="04"
          title="Appearance"
          description="Personalize how DevFlow looks on your device."
        >
          <Card className="w-full overflow-hidden">
            <CardHeader
              title="Choose your theme"
              description="Your preference is applied throughout the application."
            />

            <div
              role="radiogroup"
              aria-label="Theme"
              className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3 sm:p-6"
            >
              {THEMES.map((theme) => (
                <ThemeOption
                  key={theme.value}
                  theme={theme}
                  selected={preference === theme.value}
                  onClick={() => setPreference(theme.value)}
                />
              ))}
            </div>
          </Card>
        </SettingsSection>

        {/* 05 ACTIVE SESSIONS */}
        <SettingsSection
          number="05"
          title="Active sessions"
          description="Manage where you're signed in to DevFlow."
        >
          <Card className="w-full overflow-hidden">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon name="monitor" className="size-5" />
                </span>

                <div>
                  <p className="text-sm font-semibold text-fg">
                    This device
                  </p>

                  <p className="mt-1 text-xs text-muted">
                    Sign out from your current browser session.
                  </p>
                </div>
              </div>

              <Button
                icon="logout"
                variant="secondary"
                onClick={signOut}
                loading={signingOut}
              >
                Sign out
              </Button>
            </div>

            <div className="border-t border-line p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
                    <Icon name="shield-alert" className="size-5" />
                  </span>

                  <div>
                    <p className="text-sm font-semibold text-fg">
                      Sign out everywhere
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      Revoke all active sessions, including this device.
                    </p>
                  </div>
                </div>

                <Button
                  variant="danger"
                  onClick={signOutEverywhere}
                  loading={signingOut}
                >
                  Sign out everywhere
                </Button>
              </div>
            </div>
          </Card>
        </SettingsSection>

        <p className="pb-2 text-center text-[11px] text-faint">
          DevFlow · Account settings
        </p>
      </div>
    </div>
  );
}
