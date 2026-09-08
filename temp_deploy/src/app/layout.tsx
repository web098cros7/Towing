import type { Metadata } from 'next';
import { ThemeStyles, fleetAccent } from '@towing/web-ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'TowFleet Console',
  description: 'Fleet management console for the Towing platform',
};

/** Applies the persisted theme before first paint (no flash). */
const themeInitScript = `try{if(localStorage.getItem('towfleet-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeStyles accent={fleetAccent} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
