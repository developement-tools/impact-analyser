'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Button } from '@/components/ui';

const Modal = dynamic(() => import('@/components/ui/Modal'), { ssr: false });

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Modal open={open} onClose={() => setOpen(false)}>
        Are you sure?
      </Modal>
    </>
  );
}
