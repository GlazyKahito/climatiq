import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope, Unbounded } from 'next/font/google';
import './globals.css';

// Editorial pairing: Unbounded (wordmark, headings, figures) + Manrope (UI and body); JetBrains Mono for data labels.
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin'], display: 'swap' });
const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'], display: 'swap' });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'CLIMATIQ — Understand the Heat. Anticipate the Risk.', template: '%s · CLIMATIQ' },
  description:
    'CLIMATIQ is an AI-assisted climate-intelligence and heatwave decision-support prototype for India. Not an official meteorological service.',
  applicationName: 'CLIMATIQ',
};

export const viewport: Viewport = {
  themeColor: '#22070E',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // Single site theme: sand ink on wine-black. Components style it through `dark:` variants and [data-theme="dark"].
  return (
    <html
      lang="en-IN"
      data-theme="dark"
      className={`${unbounded.variable} ${manrope.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
