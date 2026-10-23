import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function encryptionKey() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production.');
  }

  return createHash('sha256')
    .update(process.env.JWT_SECRET || 'leadgen-official-dev-secret')
    .digest();
}

export function createInvitationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function encryptInvitationToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptInvitationToken(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid invitation token data.');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
