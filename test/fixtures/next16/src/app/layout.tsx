import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import './globals.css';

export const metadata: Metadata = { title: 'impact-analyser playground' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
