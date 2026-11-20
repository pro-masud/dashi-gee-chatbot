import { isStoreFieldConfirmed, type StoreSettingsDoc } from './storeTypes';

export interface StorefrontStructuredData {
  '@context': string;
  '@graph': Array<Record<string, unknown>>;
}

/**
 * S0-10 & Stage 4.10: Build dynamic Storefront JSON-LD grounded in owner-confirmed StoreSettings.
 * When `confirmedFromDb` is false or individual variant prices are not owner-confirmed,
 * omits unconfirmed Product `offers` so search engines never index unconfirmed fallback prices.
 */
export function buildStorefrontStructuredData(params: {
  settings: StoreSettingsDoc;
  confirmedFromDb: boolean;
}): StorefrontStructuredData {
  const { settings, confirmedFromDb } = params;
  const productNode: Record<string, unknown> = {
    '@type': 'Product',
    name: settings.productNameEn || 'Deshi Gee — Pabna Grass-Fed Bilona Cow Ghee',
    description:
      'Single-origin cultured cow milkfat churned using traditional wooden bilona and clarified slowly in earthen pots.',
    brand: {
      '@type': 'Brand',
      name: 'Deshi Gee',
    },
  };

  if (confirmedFromDb) {
    const variants: Array<{
      name: string;
      sku: string;
      price: number;
      stock: number;
      confirmed: boolean;
    }> = [
      {
        name: 'Deshi Gee 250g Sealed Glass Jar',
        sku: 'DG-250G',
        price: Math.round(settings.price250g),
        stock: Math.round(settings.stock250g),
        confirmed: isStoreFieldConfirmed(settings, 'price250g'),
      },
      {
        name: 'Deshi Gee 500g Sealed Glass Jar',
        sku: 'DG-500G',
        price: Math.round(settings.price500g),
        stock: Math.round(settings.stock500g),
        confirmed: isStoreFieldConfirmed(settings, 'price500g'),
      },
      {
        name: 'Deshi Gee 1kg Sealed Glass Jar',
        sku: 'DG-1KG',
        price: Math.round(settings.price1kg),
        stock: Math.round(settings.stock1kg),
        confirmed: isStoreFieldConfirmed(settings, 'price1kg'),
      },
    ].filter((v) => v.confirmed && Number.isFinite(v.price) && v.price > 0);

    if (variants.length > 0) {
      const prices = variants.map((v) => v.price);
      const anyInStock = variants.some((v) => v.stock > 0);
      productNode.offers = {
        '@type': 'AggregateOffer',
        priceCurrency: 'BDT',
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: variants.length,
        availability: anyInStock
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        offers: variants.map((v) => ({
          '@type': 'Offer',
          name: v.name,
          sku: v.sku,
          price: v.price,
          priceCurrency: 'BDT',
          availability:
            v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        })),
      };
    }
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Deshi Gee',
        description:
          'Bangladeshi artisanal single-product bilona cow ghee house sourcing from Pabna grass-fed farms.',
      },
      productNode,
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
}
