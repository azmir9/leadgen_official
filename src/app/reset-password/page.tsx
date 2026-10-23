import { ResetPasswordForm } from '@/components/password-reset-forms';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reset Password | Leadgen Official', robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <main className="auth-shell flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10"><ResetPasswordForm /></main>;
}
