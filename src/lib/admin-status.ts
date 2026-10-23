export const DEFAULT_ADMIN_INACTIVITY_MINUTES = 15;
const MAX_ADMIN_INACTIVITY_MINUTES = 24 * 60;

export function getAdminInactivityWindowMs(value = process.env.ADMIN_INACTIVITY_MINUTES) {
  const minutes = Number(value);
  const safeMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_ADMIN_INACTIVITY_MINUTES
    ? minutes
    : DEFAULT_ADMIN_INACTIVITY_MINUTES;
  return safeMinutes * 60_000;
}

type AdminActivity = {
  _id: unknown;
  status: string;
  deletedAt?: Date | string | null;
  lastActiveAt?: Date | string | null;
  lastLoggedOutAt?: Date | string | null;
};

export function deriveAdminStatus(
  admin: AdminActivity,
  activeSessionIds: ReadonlySet<string>,
  now = Date.now(),
  inactivityWindowMs = getAdminInactivityWindowMs(),
) {
  if (admin.deletedAt || admin.status === 'deleted') return 'deleted' as const;
  if (admin.status === 'blocked') return 'blocked' as const;
  if (admin.status !== 'active') return 'inactive' as const;
  if (activeSessionIds.has(String(admin._id))) return 'active' as const;

  const lastActive = admin.lastActiveAt ? new Date(admin.lastActiveAt).getTime() : NaN;
  const lastLogout = admin.lastLoggedOutAt ? new Date(admin.lastLoggedOutAt).getTime() : -Infinity;
  return Number.isFinite(lastActive) && lastActive > lastLogout && now - lastActive <= inactivityWindowMs
    ? 'active' as const
    : 'inactive' as const;
}
