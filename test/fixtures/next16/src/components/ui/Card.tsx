import type { ReactNode } from 'react';

export function Card({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 16, background: 'white' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </section>
  );
}
