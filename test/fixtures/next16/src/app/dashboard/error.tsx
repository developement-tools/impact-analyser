'use client';

import { Button } from '@/components/ui';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong.</p>
      <Button onClick={reset}>Retry</Button>
    </div>
  );
}
