'use client';

import { useRouter } from 'next/navigation';
import { BatchVerifyView } from '../components/BatchVerifyView';
import { useStorefront } from '../components/StorefrontProvider';

export function BatchRouteClient({ queryCode }: { queryCode?: string }) {
  const { lang, settings } = useStorefront();
  const router = useRouter();

  return (
    <BatchVerifyView
      lang={lang}
      initialBatchCode={queryCode || settings.activeBatchCode}
      onBackHome={() => router.push('/')}
    />
  );
}
