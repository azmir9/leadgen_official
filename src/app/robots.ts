import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL || 'https://leadgenofficial.com';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/super-admin/', '/worker/', '/dashboard/', '/api/', '/register?invite=', '/reset-password?'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
