import { BatchRouteClient } from '../../src/components/BatchRouteClient';

export default async function BatchPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const resolved = await searchParams;
  return <BatchRouteClient queryCode={resolved.code || ''} />;
}
