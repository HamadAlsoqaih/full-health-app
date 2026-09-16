/**
 * Settings: profile, units, notifications, AI toggles, Premium, account.
 *
 * The AI toggles are real and consequential: switching AI off stops meal photos
 * and trend summaries being sent to a third-party provider, and the app keeps
 * working — the deterministic analysis is unaffected. That is worth saying on the
 * screen, so the choice is informed rather than a leap.
 */
import { useState } from 'react';
import type { AiPreferences, NotificationPreferences, UnitSystem } from '@app/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { Button, Card, Screen, SelectField } from '@/shared/components/Field';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonCard } from '@/shared/components/Skeleton';
import { useToast } from '@/shared/components/Toast';
import { useAuthActions, useMe } from '@/features/auth/hooks/useAuth';
import { authApi } from '@/features/auth/api';
import { settingsApi } from '../api';
import { PremiumUpsell } from './PremiumUpsell';

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-touch items-start justify-between gap-4 py-2 ${disabled ? 'opacity-50' : ''}`}
    >
      <span className="flex flex-col">
        <span className="text-sm font-medium text-text">{label}</span>
        {description ? <span className="text-xs text-text-muted">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-6 shrink-0 accent-accent"
      />
    </label>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { client } = useApi();
  const queryClient = useQueryClient();
  const me = useMe(true);
  const { logout } = useAuthActions();
  const [signingOut, setSigningOut] = useState(false);

  const billing = useQuery({
    queryKey: queryKeys.billing,
    queryFn: () => settingsApi(client).billingStatus(),
  });

  const update = useMutation({
    mutationFn: (patch: Parameters<ReturnType<typeof authApi>['updateMe']>[0]) =>
      authApi(client).updateMe(patch),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      toast.show('Saved.', 'success');
    },
    onError: () => toast.show('Could not save that change.', 'error'),
  });

  if (me.isLoading) {
    return (
      <Screen title="Settings">
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      </Screen>
    );
  }

  if (me.isError || !me.data) {
    return (
      <Screen title="Settings">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }

  const user = me.data;
  const notifications: NotificationPreferences = user.preferences.notifications;
  const ai: AiPreferences = user.preferences.ai;

  const setNotification = (patch: Partial<NotificationPreferences>) =>
    update.mutate({ preferences: { notifications: patch } });
  const setAi = (patch: Partial<AiPreferences>) => update.mutate({ preferences: { ai: patch } });

  return (
    <Screen title="Settings">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-text-muted">Account</h2>
            <p className="font-medium text-text">{user.email}</p>
            <p className="text-xs text-text-muted">
              Joined {new Date(user.createdAt).toLocaleDateString()}
              {' · '}
              {billing.data?.plan === 'premium' ? 'Premium' : 'Free plan'}
            </p>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-text-muted">Units</h2>
            <SelectField
              label="Measurement units"
              hint="Your data is always stored in metric; this only changes how it is shown."
              value={user.units}
              onChange={(event) => update.mutate({ units: event.target.value as UnitSystem })}
              options={[
                { value: 'metric', label: 'Metric (kg, cm)' },
                { value: 'imperial', label: 'Imperial (lb, in)' },
              ]}
            />
          </div>
        </Card>

        <Card>
          <div className="flex flex-col divide-y divide-border">
            <h2 className="pb-2 text-sm font-medium text-text-muted">Notifications</h2>
            <Toggle
              label="Reminders"
              description="Nudges to log your meals and workouts."
              checked={notifications.remindersEnabled}
              onChange={(value) => setNotification({ remindersEnabled: value })}
            />
            <Toggle
              label="Check-in ready"
              description="Tell me when a new body-composition summary is ready."
              checked={notifications.evaluationReadyEnabled}
              onChange={(value) => setNotification({ evaluationReadyEnabled: value })}
            />
          </div>
        </Card>

        <Card>
          <div className="flex flex-col divide-y divide-border">
            <div className="flex flex-col gap-1 pb-2">
              <h2 className="text-sm font-medium text-text-muted">AI features</h2>
              <p className="text-xs text-text-muted">
                These send data to a third-party AI provider. Your weight and calorie analysis is
                calculated by the app itself and does not depend on them.
              </p>
            </div>

            <Toggle
              label="Enable AI features"
              description="Master switch. Off means nothing is sent to an AI provider."
              checked={ai.enabled}
              onChange={(value) => setAi({ enabled: value })}
            />
            <Toggle
              label="Meal photo scanning"
              description="Sends the photo you take to Google Gemini for an estimate."
              checked={ai.photoScanEnabled}
              disabled={!ai.enabled}
              onChange={(value) => setAi({ photoScanEnabled: value })}
            />
            <Toggle
              label="Written check-in summaries"
              description="Sends a short, non-identifying summary of your trend to be reworded."
              checked={ai.evaluationEnabled}
              disabled={!ai.enabled}
              onChange={(value) => setAi({ evaluationEnabled: value })}
            />
          </div>
        </Card>

        <PremiumUpsell />

        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-text-muted">Legal</h2>
            <p className="text-xs text-text-muted">
              Your health data is stored outside Saudi Arabia. See the privacy policy for what is
              collected, who processes it, and how to request deletion.
            </p>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">Privacy policy · Terms of service</span>
            </div>
          </div>
        </Card>

        <Button
          variant="danger"
          loading={signingOut}
          onClick={() => {
            setSigningOut(true);
            void logout().finally(() => setSigningOut(false));
          }}
        >
          Log out
        </Button>

        <p className="pb-4 text-center text-xs text-text-muted">
          Full Health · not a medical device
        </p>
      </div>
    </Screen>
  );
}
