import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Orbitron, Space_Grotesk } from 'next/font/google';
import './globals.css';

const orbitron = Orbitron({ variable: '--font-orbitron', subsets: ['latin'], weight: ['500', '700', '800'], display: 'swap' });
const spaceGrotesk = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'], display: 'swap' });
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
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
      className={`${orbitron.variable} ${spaceGrotesk.variable} ${inter.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
