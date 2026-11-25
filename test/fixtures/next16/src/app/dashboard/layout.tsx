import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({ children, analytics }: { children: ReactNode; analytics: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'grid', gap: 16 }}>
        {children}
        {analytics}
      </div>
    </div>
  );
}
