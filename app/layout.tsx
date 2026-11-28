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
  title: 'Deshi Gee — খাঁটি গাওয়া ঘির বিশ্বস্ত ঠিকানা | Pure Artisanal Cow Ghee',
  description:
    'দেশি গরুর খাঁটি দুধের ক্রিম থেকে ধীরে জ্বাল দিয়ে তৈরি দানাদার ও সুঘ্রাণযুক্ত খাঁটি গাওয়া ঘি। সারা বাংলাদেশে হোম ডেলিভারি ও ক্যাশ অন ডেলিভারি।',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: 'Deshi Gee',
    title: 'Deshi Gee — খাঁটি গাওয়া ঘির বিশ্বস্ত ঠিকানা',
    description:
      'ধীরে জ্বাল দেওয়া, দানাদার আর খাঁটি সুঘ্রাণে ভরা Deshi Gee গাওয়া ঘি। পণ্য হাতে পেয়ে দেখে, ঘ্রাণ নিয়ে তারপর পরিশোধ করুন।',
    images: [
      {
        url: '/assets/images/fresh/fresh_hero_jar_1795855973640.jpg',
        alt: 'Deshi Gee pure golden granular cow ghee jar',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Deshi Gee — খাঁটি গাওয়া ঘির বিশ্বস্ত ঠিকানা',
    description:
      'দেশি গরুর দুধ থেকে ঐতিহ্যবাহী উপায়ে তৈরি দানাদার খাঁটি গাওয়া ঘি।',
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings, confirmedFromDb } = await fetchServerStoreSettingsWithMeta();
  const structuredData = buildStorefrontStructuredData({ settings, confirmedFromDb });
  const serializedSettings = JSON.parse(JSON.stringify(settings)) as typeof settings;

  return (
    <html lang="bn" data-lang="bn" data-sf-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+Bengali:wght@400;500;600;700;800&family=Noto+Serif+Bengali:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body suppressHydrationWarning>
        <ErrorBoundary>
          <StorefrontProvider initialSettings={serializedSettings}>{children}</StorefrontProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
