/**
 * Shell for the five tabs: a scrolling outlet above a fixed bottom nav.
 *
 * The outlet carries `pb-nav`, so content can scroll clear of the tab bar and the
 * home indicator instead of ending underneath them.
 */
import { Outlet } from 'react-router-dom';
import { BottomNav } from '@/shared/components/BottomNav';
import { SyncIndicator } from '@/shared/components/SyncIndicator';

export function TabLayout() {
  return (
    <div className="min-h-dvh bg-bg">
      <SyncIndicator />
      <Outlet />
      <BottomNav />
    </div>
  );
}
