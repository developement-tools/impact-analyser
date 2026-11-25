import Link from 'next/link';
import { LegacyBanner } from '@/components/LegacyBanner';
import { Badge, Card } from '@/components/ui';

export default function LegacyIndex() {
  return (
    <main>
      <LegacyBanner />
      <Card title="Legacy items">
        <Badge tone="warning">Legacy</Badge> <Link href="/legacy/42">Item #42</Link>
      </Card>
    </main>
  );
}
