import { ForgotPasswordForm } from '@/components/password-reset-forms';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Forgot Password | Leadgen Official', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <main className="auth-shell flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10"><ForgotPasswordForm /></main>;
}
