/**
 * Login — reachable from the welcome screen and from signup.
 *
 * On success the router takes over: a fully onboarded user lands on the tabs, and
 * a user who signed up but never finished resumes at the outstanding step. This
 * screen makes no routing decision of its own beyond leaving.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { Button, Screen, TextField } from '@/shared/components/Field';
import { useAuthActions } from '../hooks/useAuth';

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuthActions();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();

  const submit = async () => {
    setError(undefined);
    try {
      await login.mutateAsync({ email: email.trim(), password });
      navigate('/app/overview', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not log in. Try again.');
    }
  };

  return (
    <Screen>
      <form
        className="flex min-h-dvh flex-col justify-between py-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-text">Welcome back</h1>
            <p className="text-sm text-text-muted">Log in to pick up where you left off.</p>
          </header>

          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="done"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 pt-6">
          <Button type="submit" loading={login.isPending} disabled={!email.trim() || !password}>
            Log in
          </Button>
          <button
            type="button"
            onClick={() => navigate('/onboarding/welcome')}
            className="min-h-touch text-sm font-medium text-accent active:opacity-70"
          >
            New here? Get started
          </button>
        </div>
      </form>
    </Screen>
  );
}
