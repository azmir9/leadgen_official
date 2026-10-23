import { AuthForm } from '@/components/auth-form';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Login | Leadgen Official', robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main className="auth-shell flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <AuthForm mode="login" />
    </main>
  );
}
