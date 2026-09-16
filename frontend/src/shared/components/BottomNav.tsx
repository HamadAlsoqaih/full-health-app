/**
 * The bottom tab bar — the app's primary navigation.
 *
 * Mobile conventions this exists to honour:
 *  - Fixed to the bottom, in the thumb zone, not a top bar or a hamburger.
 *  - Padded by `env(safe-area-inset-bottom)` so it clears the iOS home indicator
 *    rather than sitting under it.
 *  - Each target is at least 44px tall (Apple HIG) / 48dp (Material).
 *  - Exactly five tabs. More than five does not fit a phone width legibly, which
 *    is why the platform guidelines cap it there too.
 *  - The active tab is marked by an accent colour AND a weight change AND an
 *    underline bar, so it is never signalled by colour alone. NavLink adds
 *    aria-current="page" itself, so it is not set here.
 *
 * Deliberately NOT `role="tablist"`/`role="tab"`, despite looking like tabs.
 * These navigate between routes; they do not switch panels within one view. Two
 * concrete problems with the tab roles here: `role="tab"` on an anchor replaces
 * its implicit `link` role, so assistive technology stops reporting the bar as
 * navigation at all — and the tab role requires `aria-selected` plus an owning
 * `tabpanel`, neither of which exists, so the result is invalid ARIA rather than
 * richer semantics. A labelled `<nav>` of links carrying `aria-current="page"`
 * is the pattern for this, and it is what screen readers already announce well.
 */
import { NavLink } from 'react-router-dom';

interface Tab {
  to: string;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { to: '/app/overview', label: 'Overview', icon: '◎' },
  { to: '/app/training', label: 'Training', icon: '▲' },
  { to: '/app/nutrition', label: 'Nutrition', icon: '●' },
  { to: '/app/body', label: 'Body', icon: '◆' },
  { to: '/app/settings', label: 'Settings', icon: '⚙' },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-safe shadow-nav"
    >
      <ul className="mx-auto flex max-w-content-max">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              // The whole cell is the target, not just the label text.
              className={({ isActive }) =>
                [
                  'flex min-h-nav-h w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5',
                  'text-xs transition-opacity active:opacity-60',
                  isActive ? 'font-semibold text-accent' : 'font-normal text-text-muted',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden="true" className="text-lg leading-none">
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  {/* Second, non-colour cue for the active tab. */}
                  <span
                    aria-hidden="true"
                    className={`h-0.5 w-6 rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`}
                  />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
