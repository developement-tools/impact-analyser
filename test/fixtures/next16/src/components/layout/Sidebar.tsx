import Link from 'next/link';
import { Settings } from '@/components/icons';

export function Sidebar() {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
      <Link href="/dashboard">Overview</Link>
      <Link href="/dashboard/settings">
        <Settings /> Settings
      </Link>
    </aside>
  );
}
