import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionFromCookies } from '@/lib/auth';
import { WorkerWorkspace } from '@/components/worker-workspace';
import { connectDB } from '@/lib/db';
import { CompanySettings } from '@/lib/models';

export const metadata: Metadata = { title: 'Worker Workspace | Leadgen Official', robots: { index: false, follow: false } };

export default async function WorkerPage() {
  const session = await getSessionFromCookies();

  if (!session || session.role !== 'worker') {
    redirect('/login');
  }

  let company = { companyName: 'Leadgen Official', ownerName: 'Leadgen Official Owner', announcement: 'Welcome to Leadgen Official.', logoUrl: '' };
  try {
    await connectDB();
    const settings = await CompanySettings.findOne().select('companyName ownerName announcement logoUrl').lean();
    if (settings) company = { companyName: settings.companyName, ownerName: settings.ownerName, announcement: settings.announcement, logoUrl: settings.logoUrl };
  } catch {
    // Keep the worker portal branded consistently if optional CMS data is unavailable.
  }

  return <WorkerWorkspace name={session.name} status={session.status || 'active'} workspaceId={session.workspaceId || null} companyName={company.companyName} ownerName={company.ownerName} announcement={company.announcement} logoUrl={company.logoUrl} />;
}
