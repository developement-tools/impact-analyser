import { useRouter } from 'next/router';
import { LegacyBanner } from '@/components/LegacyBanner';
import { formatDate } from '@/lib/format';

export default function LegacyItem() {
  const { query } = useRouter();
  return (
    <main>
      <LegacyBanner />
      <h1>Item {query.id}</h1>
      <p>Viewed on {formatDate(new Date())}</p>
    </main>
  );
}
