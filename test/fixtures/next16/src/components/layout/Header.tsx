import Link from 'next/link';
import * as Icons from '@/components/icons';
import { Button } from '@/components/ui';

export function Header() {
  return (
    <header style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid #e5e5e5' }}>
      <strong>Playground</strong>
      <nav style={{ display: 'flex', gap: 12, flex: 1 }}>
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
        <Link href="/blog/hello-world">Blog</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/legacy">Legacy (pages)</Link>
      </nav>
      <Link href="/checkout" aria-label="Cart">
        <Icons.Cart />
      </Link>
      <Button variant="primary" size="sm">
        <Icons.User /> Sign in
      </Button>
    </header>
  );
}
