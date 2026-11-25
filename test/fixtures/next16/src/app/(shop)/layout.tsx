import type { ReactNode } from 'react';
import { ShopBanner } from '@/components/shop/ShopBanner';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ShopBanner />
      {children}
    </>
  );
}
