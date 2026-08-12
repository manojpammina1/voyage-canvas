import type { Metadata } from 'next';
import { Geist, Inter } from 'next/font/google';
import '../styles/canvas.css';

/* DESIGN.md typography: Geist for display/headline/label-caps, Inter for body
 * and evidence-data. Exposed as CSS variables on <html> so tokens.css can point
 * --font-display / --font-body at them without any component knowing the names. */
const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

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
    <html lang="en" className={`${geist.variable} ${inter.variable}`}>
      <body style={{ fontFamily: 'var(--font-body)' }}>{children}</body>
    </html>
  );
}
