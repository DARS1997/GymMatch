import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RoleProvider } from '@/context/RoleContext';
import { MobileContainer } from '@/components/layout/MobileContainer';

export const metadata: Metadata = {
  title: 'GymMatch Linz — On-Demand Personal Training PWA',
  description:
    'On-demand personal training booking platform across partner gyms in Linz, Austria with live split payments and cryptographic QR check-in.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GymMatch Linz',
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <RoleProvider>
          <MobileContainer>{children}</MobileContainer>
        </RoleProvider>

        {/* Client-side Service Worker registration for PWA functionality */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(reg) { console.log('[GymMatch PWA] SW registered with scope:', reg.scope); },
                    function(err) { console.warn('[GymMatch PWA] SW registration failed:', err); }
                  );
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
