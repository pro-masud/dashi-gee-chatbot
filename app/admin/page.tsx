'use client';

import { useRouter } from 'next/navigation';
import { AdminDashboardView } from '../../src/components/AdminDashboardView';
import { useStorefront } from '../../src/components/StorefrontProvider';

export default function AdminPage() {
  const { settings, setSettings } = useStorefront();
  const router = useRouter();

  return (
    <AdminDashboardView
      settings={settings}
      onSettingsUpdated={(next) => setSettings(next)}
      onBackHome={() => router.push('/')}
    />
  );
}
