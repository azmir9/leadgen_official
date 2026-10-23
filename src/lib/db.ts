import mongoose from 'mongoose';
import type { AuthDiagnosticContext } from '@/lib/auth-diagnostics';

type MongooseCache = { connection: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalWithMongoose = globalThis as typeof globalThis & { mongooseCache?: MongooseCache };
const cache = globalWithMongoose.mongooseCache || { connection: null, promise: null };
globalWithMongoose.mongooseCache = cache;

// Keep schema index reconciliation in an explicit migration step so legacy index conflicts cannot block every database-backed request.
export async function connectDB(diagnostics?: AuthDiagnosticContext) {
  const readyState = getReadyState();
  if (diagnostics) diagnostics.connectionReadyStateBefore = readyState;
  if (cache.connection?.connection.readyState === 1) {
    if (diagnostics) {
      diagnostics.connectionAction = 'ready_cache';
      diagnostics.connectionReadyStateAfter = getReadyState();
    }
    return cache.connection;
  }

  try {
    mongoose.set('strictQuery', true);
    if (!cache.promise) {
      if (diagnostics) diagnostics.connectionAction = 'new_connect';
      const mongoUri = process.env.MONGODB_URI?.trim();
      if (!mongoUri) {
        throw new Error('MONGODB_URI must be configured before connecting to the database.');
      }

      // Index reconciliation is an explicit migration task, never a side effect of requests.
      // Set MONGOOSE_AUTO_INDEX=true only for an isolated disposable database.
      const autoIndex = process.env.MONGOOSE_AUTO_INDEX === 'true';
      cache.promise = mongoose.connect(mongoUri, { autoIndex }).catch((error) => {
        cache.promise = null;
        throw error;
      });
    } else if (diagnostics) {
      diagnostics.connectionAction = 'cached_promise';
    }

    cache.connection = await cache.promise;
    return cache.connection;
  } finally {
    if (diagnostics) diagnostics.connectionReadyStateAfter = getReadyState();
  }
}

function getReadyState() {
  const state = mongoose.connection?.readyState;
  return typeof state === 'number' && Number.isInteger(state) && state >= 0 && state <= 3 ? state : -1;
}
