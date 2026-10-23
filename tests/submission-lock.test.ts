import { describe, expect, it, vi } from 'vitest';
import { createSubmissionLock, runWithSubmissionLock } from '@/lib/submission-lock';

describe('auth form submission lock', () => {
  it('sends one POST for concurrent submissions from one form instance', async () => {
    const lock = createSubmissionLock();
    let releaseResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => { releaseResponse = resolve; });
    const fetchMock = vi.fn((url: string, init: RequestInit): Promise<Response> => {
      expect(url).toBe('https://app.example.invalid/api/auth/register');
      expect(init.method).toBe('POST');
      return pendingResponse;
    });
    const post = () => runWithSubmissionLock(lock, () => fetchMock('https://app.example.invalid/api/auth/register', { method: 'POST' }));

    const firstSubmission = post();
    const duplicateSubmission = post();
    expect(fetchMock).toHaveBeenCalledOnce();
    releaseResponse(new Response('{}', { status: 201 }));
    await expect(firstSubmission).resolves.toMatchObject({ status: 201 });
    await expect(duplicateSubmission).resolves.toBeUndefined();
  });

  it('releases the guard after a failed request so a manual retry can run', async () => {
    const lock = createSubmissionLock();
    const fetchMock = vi.fn(async (): Promise<Response> => new Response('{}'));
    fetchMock.mockRejectedValueOnce(new Error('network failed'));

    await expect(runWithSubmissionLock(lock, () => fetchMock())).rejects.toThrow('network failed');
    await expect(runWithSubmissionLock(lock, () => fetchMock())).resolves.toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows a later intentional retry after a validation response settles', async () => {
    const lock = createSubmissionLock();
    const fetchMock = vi.fn(async (): Promise<Response> => new Response('{}'));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const first = await runWithSubmissionLock(lock, () => fetchMock());
    const second = await runWithSubmissionLock(lock, () => fetchMock());

    expect(first?.status).toBe(400);
    expect(second?.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
