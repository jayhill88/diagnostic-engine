import { createClient } from 'ioredis';
import type { DiagnosticSession } from './types';

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', console.error);
await redis.connect();

export const sessionStore = {
  getSession: async (id: string) => {
    const data = await redis.get(`session:${id}`);
    return data ? JSON.parse(data) : null;
  },
  saveSession: async (id: string, session: DiagnosticSession) => {
    await redis.set(`session:${id}`, JSON.stringify(session));
  }
};