'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';

export default function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ background: 'white', padding: 24, borderRadius: 8 }}>
        {children}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
