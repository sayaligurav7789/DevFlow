import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Field, Input, Notice } from '../components/ui/index.js';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">

      <div className="w-full max-w-[360px]">

        <div className="mb-8 flex flex-col items-center text-center">

          <span className="mb-5 flex size-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-pop">

            <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.500 4.500h5.500a3 3 0 0 1 0 6H5M3.500 4.500v7" /></svg>

          </span>

          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>

          <p className="mt-1.5 text-[13.5px] text-muted">{subtitle}</p>

        </div>

        {children}

        <p className="mt-6 text-center text-[13px] text-muted">{footer}</p>

      </div>

    </main>

  );

}

function PasswordInput({ visible, onToggle, ...inputProps }) {
  return (
    <div className="relative">
      <Input
        {...inputProps}
        type={visible ? 'text' : 'password'}
        className={`${inputProps.className ?? ''} pr-10`}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-fg"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" className="size-5" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7s-1 2-3.1 3.9" />
            <path d="M6.6 6.6C3.6 8.4 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {

  const { login } = useAuth();

  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const [errors, setErrors] = useState({});

  const [formError, setFormError] = useState('');

  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {

    event.preventDefault();

    const next = {};

    if (!EMAIL.test(form.email.trim())) next.email = 'Enter a valid email address.';

    if (!form.password) next.password = 'Enter your password.';

    setErrors(next);

    setFormError('');

    if (Object.keys(next).length) return;

    setBusy(true);

    try {

      await login({ email: form.email.trim(), password: form.password });

      // GuestOnly redirects to the page the user originally wanted.

    } catch (error) {

      setFormError(error.message);

      setBusy(false);

    }

  }

  return (
    <AuthShell
      title="Welcome back"

      subtitle="Sign in to continue to DevFlow."

      footer={<>New to DevFlow? <Link to="/register" state={location.state} className="font-medium text-accent hover:underline">Create an account</Link></>}

    >

      {location.state?.expired && !formError && (

        <Notice tone="warning" className="mb-4" title="Your session expired">Sign in again to pick up where you left off.</Notice>

      )}

      {formError && <Notice tone="error" className="mb-4">{formError}</Notice>}

      <form onSubmit={onSubmit} noValidate className="space-y-4">

        <Field label="Email" error={errors.email}>

          {(p) => <Input {...p} type="email" name="email" autoComplete="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />}

        </Field>

        <div className="-mt-2 text-right"><Link to="/forgot-password" className="text-[12px] font-medium text-accent hover:underline">Forgot password?</Link></div>

        <Field label="Password" error={errors.password}>

          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              visible={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
            />
          )}

        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">Sign in</Button>

      </form>

    </AuthShell>

  );

}

export function RegisterPage() {

  const { register } = useAuth();

  const location = useLocation();

  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const [errors, setErrors] = useState({});

  const [formError, setFormError] = useState('');

  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {

    event.preventDefault();

    const next = {};

    const name = form.displayName.trim();

    if (!name || name.length > 80) next.displayName = 'Enter a name up to 80 characters.';

    if (!EMAIL.test(form.email.trim())) next.email = 'Enter a valid email address.';

    if (form.password.length < 12) next.password = 'Use at least 12 characters.';

    setErrors(next);

    setFormError('');

    if (Object.keys(next).length) return;

    setBusy(true);

    try {

      await register({ displayName: name, email: form.email.trim(), password: form.password });

    } catch (error) {

      if (error.status === 409) setErrors({ email: error.message });

      else setFormError(error.message);

      setBusy(false);

    }

  }

  return (

    <AuthShell

      title="Create your account"

      subtitle="Plan, track, and ship with your team."

      footer={<>Already have an account? <Link to="/login" state={location.state} className="font-medium text-accent hover:underline">Sign in</Link></>}

    >

      {formError && <Notice tone="error" className="mb-4">{formError}</Notice>}

      <form onSubmit={onSubmit} noValidate className="space-y-4">

        <Field label="Full name" error={errors.displayName}>

          {(p) => <Input {...p} name="displayName" autoComplete="name" autoFocus maxLength={80} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}

        </Field>

        <Field label="Email" error={errors.email}>

          {(p) => <Input {...p} type="email" name="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />}

        </Field>

        <Field label="Password" error={errors.password} hint="At least 12 characters.">

          {(p) => (
            <PasswordInput
              {...p}
              name="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              visible={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
            />
          )}

        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">Create account</Button>

      </form>

    </AuthShell>

  );

}

export function ForgotPasswordPage() {

  const [email, setEmail] = useState('');

  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState('');

  const [error, setError] = useState('');

  async function submit(event) {

    event.preventDefault(); setBusy(true); setError(''); setMessage('');

    try { const { authApi } = await import('../lib/endpoints.js'); const result = await authApi.forgotPassword({ email }); setMessage(result.message); }

    catch (e) { setError(e.message); } finally { setBusy(false); }

  }

  return <AuthShell title="Reset your password" subtitle="We'll email you a secure reset link." footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>

    {message && <Notice tone="success" className="mb-4">{message}</Notice>}{error && <Notice tone="error" className="mb-4">{error}</Notice>}

    <form onSubmit={submit} className="space-y-4"><Field label="Email">{(p) => <Input {...p} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field><Button type="submit" variant="primary" loading={busy} className="w-full">Send reset link</Button></form>

  </AuthShell>;

}

export function AccountActionPage({ mode }) {

  const { refreshUser, logout } = useAuth();

  const location = useLocation();

  const navigate = useNavigate();

  const token = new URLSearchParams(location.search).get('token') || '';

  const [password, setPassword] = useState('');

  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState('');

  const [error, setError] = useState('');

  async function verify() {

    setBusy(true); setError('');

    try { const { authApi } = await import('../lib/endpoints.js'); const result = await authApi.verifyEmail({ token }); setMessage(result.message); if (result.message.startsWith('Email address updated')) await logout(); else await refreshUser().catch(() => {}); }

    catch (e) { setError(e.message); } finally { setBusy(false); }

  }

  async function reset(event) {

    event.preventDefault(); setError(''); setMessage('');

    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setBusy(true);

    try { const { authApi } = await import('../lib/endpoints.js'); const result = await authApi.resetPassword({ token, newPassword: password }); setMessage(result.message); }

    catch (e) { setError(e.message); } finally { setBusy(false); }

  }

  return <AuthShell title={mode === 'verify' ? 'Verify your email' : 'Choose a new password'} subtitle={mode === 'verify' ? 'Confirm the email address associated with your DevFlow account.' : 'Your new password must contain at least 12 characters.'} footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>

    {message && <Notice tone="success" className="mb-4">{message}</Notice>}{error && <Notice tone="error" className="mb-4">{error}</Notice>}

    {mode === 'verify' ? (
      <Button
        variant="primary"
        className="w-full"
        loading={busy}
        disabled={!token || Boolean(message)}
        onClick={verify}
      >
        Verify email
      </Button>
    ) : (
      <form onSubmit={reset} className="space-y-4">
        <Field label="New password">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              visible={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
            />
          )}
        </Field>
        <Field label="Confirm new password">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              minLength={12}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              visible={showConfirm}
              onToggle={() => setShowConfirm((prev) => !prev)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={busy}
          disabled={!token}
        >
          Reset password
        </Button>
      </form>
    )}

    {message && <Button className="mt-4 w-full" onClick={() => navigate('/login')}>Continue to sign in</Button>}

  </AuthShell>;

}
