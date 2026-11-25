import { Badge } from '@/components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { formatNumber } from '@/lib/format';

export function StatsCard({ label, value, trend }: { label: string; value: number; trend?: string }) {
  return (
    <Card title={label}>
      <strong style={{ fontSize: 28 }}>{formatNumber(value)}</strong> {trend && <Badge>{trend}</Badge>}
    </Card>
  );
}
