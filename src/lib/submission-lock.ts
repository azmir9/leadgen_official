/** Prevents concurrent submissions from a single form instance. */
export function createSubmissionLock() {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() { locked = false; },
  };
}

export async function runWithSubmissionLock<T>(
  lock: ReturnType<typeof createSubmissionLock>,
  submit: () => Promise<T>,
): Promise<T | undefined> {
  if (!lock.acquire()) return undefined;
  try {
    return await submit();
  } finally {
    lock.release();
  }
}
