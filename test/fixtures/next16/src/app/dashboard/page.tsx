import { StatsCard } from '@/features/stats/StatsCard';

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <StatsCard label="Orders" value={1284} trend="+12%" />
    </>
  );
}
