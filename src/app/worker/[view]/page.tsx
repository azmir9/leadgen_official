import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { WorkerWorkspace } from '@/components/worker-workspace';
import { getSessionFromCookies } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { CompanySettings } from '@/lib/models';

const views = ['reports', 'assignments', 'orders', 'payments', 'profile', 'announcements', 'interviews', 'security'] as const;
type WorkerView = typeof views[number];

export const metadata: Metadata = { title: 'Worker Workspace | Leadgen Official', robots: { index: false, follow: false } };

export default async function WorkerSectionPage({ params }: { params: Promise<{ view: string }> }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== 'worker') redirect('/login');
  const { view } = await params;
  if (!views.includes(view as WorkerView)) notFound();

  let company = { companyName: 'Leadgen Official', ownerName: 'Leadgen Official Owner', announcement: 'Welcome to Leadgen Official.', logoUrl: '' };
  try {
    await connectDB();
    const settings = await CompanySettings.findOne().select('companyName ownerName announcement logoUrl').lean();
    if (settings) company = { companyName: settings.companyName, ownerName: settings.ownerName, announcement: settings.announcement, logoUrl: settings.logoUrl };
  } catch {
    // Optional company branding falls back to the same defaults as the Worker overview.
  }

  return <WorkerWorkspace name={session.name} status={session.status || 'active'} workspaceId={session.workspaceId || null} companyName={company.companyName} ownerName={company.ownerName} announcement={company.announcement} logoUrl={company.logoUrl} view={view as WorkerView} />;
}
