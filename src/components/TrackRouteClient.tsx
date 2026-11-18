'use client';

import { useRouter } from 'next/navigation';
import { TrackOrderView } from '../components/TrackOrderView';
import { useStorefront } from '../components/StorefrontProvider';

export function TrackRouteClient({
  queryOrder,
  queryPhone,
}: {
  queryOrder?: string;
  queryPhone?: string;
}) {
  const { lang, trackPrefill } = useStorefront();
  const router = useRouter();

  return (
    <TrackOrderView
      lang={lang}
      initialOrderNumber={queryOrder || trackPrefill.order}
      initialPhone={queryPhone || trackPrefill.phone}
      onBackHome={() => router.push('/')}
    />
  );
}
