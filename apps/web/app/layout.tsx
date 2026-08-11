import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../styles/canvas.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
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
    <html lang="en" className={inter.variable}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: 'var(--font-body), Inter, sans-serif' }}>{children}</body>
    </html>
  );
}
