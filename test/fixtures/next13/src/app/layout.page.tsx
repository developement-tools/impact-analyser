import { Card } from '@/components/Card';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Card title="Header" />
        {children}
      </body>
    </html>
  );
}
