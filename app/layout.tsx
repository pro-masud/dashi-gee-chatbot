import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { StorefrontProvider } from '../src/components/StorefrontProvider';
import { fetchServerStoreSettingsWithMeta } from '../src/lib/chatbot/firestoreRest';
import { buildStorefrontStructuredData } from '../src/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  ),
  title: 'Deshi Gee — Pure Pabna Grass-Fed Bilona Cow Ghee',
  description:
    'Authentic single-origin Pabna grass-fed Deshi Cow Ghee churned by traditional wooden bilona. Order 250g, 500g, or 1kg sealed glass jars across Bangladesh.',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: 'Deshi Gee',
    title: 'Deshi Gee — Pure Pabna Grass-Fed Bilona Cow Ghee',
    description:
      'Authentic single-origin Pabna grass-fed Deshi Cow Ghee churned by traditional wooden bilona. Available in 250g, 500g, and 1kg sealed glass jars.',
    images: [
      {
        url: '/assets/images/hero_deshi_jar_1794893673264.jpg',
        alt: 'Sealed apothecary glass jar of Pabna grass-fed Deshi Cow Ghee',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Deshi Gee — Pure Pabna Grass-Fed Bilona Cow Ghee',
    description:
      'Authentic single-origin Pabna grass-fed Deshi Cow Ghee churned by traditional wooden bilona.',
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings, confirmedFromDb } = await fetchServerStoreSettingsWithMeta();
  const structuredData = buildStorefrontStructuredData({ settings, confirmedFromDb });

  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Serif+Bengali:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body suppressHydrationWarning>
        <ErrorBoundary>
          <StorefrontProvider initialSettings={settings}>{children}</StorefrontProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
