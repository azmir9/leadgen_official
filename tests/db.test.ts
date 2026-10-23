import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mongoose', () => ({
  default: {
    connect: vi.fn(),
    set: vi.fn(),
  },
}));
vi.mock('@/lib/migrations', () => ({
  ensureDatabaseIndexes: vi.fn(),
}));

const mockedMongoose = vi.mocked(mongoose);

type GlobalWithMongooseCache = typeof globalThis & {
  mongooseCache?: { connection: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
};

function resetConnectionCache() {
  delete (globalThis as GlobalWithMongooseCache).mongooseCache;
}

describe('connectDB', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetConnectionCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConnectionCache();
  });

  it.each([undefined, '', '   '])('rejects a missing or blank MONGODB_URI without connecting', async (mongoUri) => {
    vi.stubEnv('MONGODB_URI', mongoUri);
    const { connectDB } = await import('../src/lib/db');

    await expect(connectDB()).rejects.toThrow('MONGODB_URI must be configured');
    expect(mockedMongoose.connect).not.toHaveBeenCalled();
  });

  it('shares an in-flight connection and leaves automatic index creation disabled by default', async () => {
    vi.stubEnv('MONGOOSE_AUTO_INDEX', undefined);
    vi.stubEnv('MONGODB_URI', ' mongodb://unit-test.invalid:27017/test ');
    const fakeConnection = { connection: { readyState: 1 } } as unknown as typeof mongoose;
    vi.mocked(mockedMongoose.connect).mockResolvedValue(fakeConnection);
    const { connectDB } = await import('../src/lib/db');

    const [first, second] = await Promise.all([connectDB(), connectDB()]);

    expect(first).toBe(fakeConnection);
    expect(second).toBe(fakeConnection);
    expect(mockedMongoose.connect).toHaveBeenCalledTimes(1);
    const { ensureDatabaseIndexes } = await import('@/lib/migrations');
    expect(ensureDatabaseIndexes).not.toHaveBeenCalled();
    expect(mockedMongoose.connect).toHaveBeenCalledWith('mongodb://unit-test.invalid:27017/test', {
      autoIndex: false,
    });
  });

  it('only enables automatic index creation when explicitly opted in', async () => {
    vi.stubEnv('MONGOOSE_AUTO_INDEX', 'true');
    vi.stubEnv('MONGODB_URI', 'mongodb://unit-test.invalid:27017/test');
    const fakeConnection = { connection: { readyState: 1 } } as unknown as typeof mongoose;
    vi.mocked(mockedMongoose.connect).mockResolvedValue(fakeConnection);
    const { connectDB } = await import('../src/lib/db');

    await expect(connectDB()).resolves.toBe(fakeConnection);

    expect(mockedMongoose.connect).toHaveBeenCalledWith('mongodb://unit-test.invalid:27017/test', {
      autoIndex: true,
    });
  });

  it('disables automatic index creation when MONGOOSE_AUTO_INDEX is false', async () => {
    vi.stubEnv('MONGOOSE_AUTO_INDEX', 'false');
    vi.stubEnv('MONGODB_URI', 'mongodb://unit-test.invalid:27017/test');
    const fakeConnection = { connection: { readyState: 1 } } as unknown as typeof mongoose;
    vi.mocked(mockedMongoose.connect).mockResolvedValue(fakeConnection);
    const { connectDB } = await import('../src/lib/db');

    await expect(connectDB()).resolves.toBe(fakeConnection);

    expect(mockedMongoose.connect).toHaveBeenCalledWith('mongodb://unit-test.invalid:27017/test', {
      autoIndex: false,
    });
  });

  it('clears a failed connection promise so a later attempt can retry', async () => {
    vi.stubEnv('MONGODB_URI', 'mongodb://unit-test.invalid:27017/test');
    const fakeConnection = { connection: { readyState: 1 } } as unknown as typeof mongoose;
    vi.mocked(mockedMongoose.connect)
      .mockRejectedValueOnce(new Error('mock connection failure'))
      .mockResolvedValueOnce(fakeConnection);
    const { connectDB } = await import('../src/lib/db');

    await expect(connectDB()).rejects.toThrow('mock connection failure');
    await expect(connectDB()).resolves.toBe(fakeConnection);
    expect(mockedMongoose.connect).toHaveBeenCalledTimes(2);
  });
});
