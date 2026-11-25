import { Badge } from '@/components/ui';

export function ShopBanner() {
  return (
    <p style={{ background: '#f0f9ff', padding: 12, borderRadius: 6 }}>
      <Badge tone="warning">Sale</Badge> Free shipping this week.
    </p>
  );
}
