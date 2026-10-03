import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Orbitron, Space_Grotesk } from 'next/font/google';
import { cookies } from 'next/headers';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5EBD0' },
    { media: '(prefers-color-scheme: dark)', color: '#12060A' },
  ],
};

/** Inline, render-blocking theme resolver for "system" preference (prevents a flash of the wrong theme). */
const themeScript = `(function(){try{var d=document.documentElement;if(d.dataset.theme==='system'){d.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}}catch(e){}})();`;

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = (await cookies()).get('cq_theme')?.value;
  // Light Sand is the default theme; dark (or following the OS) is opt-in via the theme toggle.
  const initial = theme === 'dark' || theme === 'system' ? theme : 'light';
  return (
    <html
      lang="en-IN"
      data-theme={initial}
      suppressHydrationWarning
      className={`${orbitron.variable} ${spaceGrotesk.variable} ${inter.variable} ${jetbrains.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
