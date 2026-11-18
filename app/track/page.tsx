import { TrackRouteClient } from '../../src/components/TrackRouteClient';

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; phone?: string }>;
}) {
  const resolved = await searchParams;
  return (
    <TrackRouteClient
      queryOrder={resolved.order || ''}
      queryPhone={resolved.phone || ''}
    />
  );
}
