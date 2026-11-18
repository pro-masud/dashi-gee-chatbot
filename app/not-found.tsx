'use client';

import Link from 'next/link';
import { useStorefront } from '../src/components/StorefrontProvider';

export default function NotFoundPage() {
  const { lang } = useStorefront();
  const bn = lang === 'bn';

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-5 py-20 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-[#8A5A17]">
        404
      </p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-[#1E1710]">
        {bn ? 'পৃষ্ঠাটি পাওয়া যায়নি' : 'Page Not Found'}
      </h1>
      <p className="mt-2 text-sm text-[#635647]">
        {bn
          ? 'আপনি যে ঠিকানাটি খুঁজছেন তা পাওয়া যায়নি।'
          : 'The page you requested does not exist on Deshi Gee.'}
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-[#B47B2B] px-6 py-3 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B]"
      >
        {bn ? 'হোমপেজে ফিরে যান' : 'Return Home'}
      </Link>
    </section>
  );
}
