import { redirect } from 'next/navigation';

/** Alerts live in the Advisories & alerts module; keep /alerts as a stable entry point. */
export default async function AlertsIndex({ searchParams }: PageProps<'/alerts'>) {
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: 'alerts' });
  for (const k of ['status', 'severity', 'region', 'scenario']) {
    const v = sp[k];
    if (typeof v === 'string') params.set(k, v);
  }
  redirect(`/advisories?${params.toString()}`);
}
