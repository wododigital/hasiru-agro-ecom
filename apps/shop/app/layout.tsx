import type { Metadata } from 'next';
import { DM_Serif_Display, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted at build time, latin only. theme.css maps --font-display / --font-body to these variables.
const display = DM_Serif_Display({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--font-dm-serif-display' });
const body = Outfit({ subsets: ['latin'], display: 'swap', variable: '--font-outfit' });

export const metadata: Metadata = {
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
