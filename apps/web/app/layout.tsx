import type { Metadata } from 'next';
import '../styles/canvas.css';

export const metadata: Metadata = {
  title: 'Voyage Canvas',
  description: 'Adaptive Serenity cruise planning assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'var(--font-body), system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
