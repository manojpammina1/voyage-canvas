import type { Metadata } from 'next';
import '../styles/canvas.css';

export const metadata: Metadata = {
  title: 'Royal Caribbean',
  description: 'Royal Caribbean cruise planning assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'var(--font-body)' }}>{children}</body>
    </html>
  );
}
