import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AdminHistoryWorkspace } from '@/components/admin-history-workspace';
import { getSessionFromCookies } from '@/lib/auth';

export const metadata: Metadata = { title: 'Admin History | Leadgen Official', robots: { index: false, follow: false } };

export default async function AdminHistoryPage() {
  const session = await getSessionFromCookies();
  if (!session || session.role !== 'super-admin') redirect('/login');
  return <AdminHistoryWorkspace />;
}
