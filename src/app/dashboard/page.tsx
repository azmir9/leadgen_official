import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionFromCookies } from '@/lib/auth';

export const metadata: Metadata = { title: 'Dashboard | Leadgen Official', robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const session = await getSessionFromCookies();

  if (!session) {
    redirect('/login');
  }

  const role = session.role;
  redirect(role === 'super-admin' ? '/super-admin' : role === 'admin' ? '/admin' : '/worker');
}
