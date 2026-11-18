import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { StorefrontProvider } from '../src/components/StorefrontProvider';

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

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Deshi Gee',
      description:
        'Bangladeshi artisanal single-product bilona cow ghee house sourcing from Pabna grass-fed farms.',
    },
    {
      '@type': 'Product',
      name: 'Deshi Gee — Pabna Grass-Fed Bilona Cow Ghee',
      description:
        'Single-origin cultured cow milkfat churned using traditional wooden bilona and clarified slowly in earthen pots.',
      brand: {
        '@type': 'Brand',
        name: 'Deshi Gee',
      },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'BDT',
        lowPrice: '680',
        highPrice: '2480',
        offerCount: '3',
        availability: 'https://schema.org/InStock',
        offers: [
          {
            '@type': 'Offer',
            name: 'Deshi Gee 250g Sealed Glass Jar',
            sku: 'DG-250G',
            price: '680',
            priceCurrency: 'BDT',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Deshi Gee 500g Sealed Glass Jar',
            sku: 'DG-500G',
            price: '1290',
            priceCurrency: 'BDT',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Deshi Gee 1kg Sealed Glass Jar',
            sku: 'DG-1KG',
            price: '2480',
            priceCurrency: 'BDT',
            availability: 'https://schema.org/InStock',
          },
        ],
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is this authentic Deshi Ghee?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Each batch is prepared exclusively from cultured whole cow milk sourced in Pabna, churned by wooden bilona, and sealed in glass jars with batch traceability.',
          },
        },
        {
          '@type': 'Question',
          name: 'What weight options are available?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Deshi Gee is offered in 250g, 500g, and 1kg sealed apothecary glass jars.',
          },
        },
      ],
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Serif+Bengali:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        <ErrorBoundary>
          <StorefrontProvider>{children}</StorefrontProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
