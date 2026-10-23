import { NextResponse } from 'next/server';
import { revokeServerSession } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });

  const token = request.headers.get('cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith('leadgen_session='))?.slice('leadgen_session='.length);
  if (token) {
    try { await revokeServerSession(decodeURIComponent(token)); } catch { /* The cookie is still cleared if the database is unavailable. */ }
  }
  const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set('leadgen_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return response;
}
