import type { ReactNode } from 'react';

const COLORS = { neutral: '#e5e5e5', success: '#bbf7d0', warning: '#fde68a', danger: '#fecaca' };

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof COLORS; children: ReactNode }) {
  return <span style={{ background: COLORS[tone], padding: '2px 8px', borderRadius: 99, fontSize: 12 }}>{children}</span>;
}
