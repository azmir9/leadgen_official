import './globals.css';
import type { Metadata } from 'next';
import { ThemeControls } from '@/components/theme-controls';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'https://leadgenofficial.com'),
  title: 'Leadgen Official',
  description: 'Lead generation, marketing, reporting, and workspace management platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<ThemeControls /></body>
    </html>
  );
}
