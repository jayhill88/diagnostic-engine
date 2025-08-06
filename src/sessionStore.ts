import Redis from 'ioredis';
import type { DiagnosticSession } from './types';

let redisClient: Redis | null = null;
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

if (REDIS_ENABLED) {
  redisClient = new Redis();
  redisClient.on('error', console.error);
}

export const sessionStore = {
  getSession: async (id: string) => {
    if (!REDIS_ENABLED || !redisClient) return null;
    const data = await redisClient.get(`session:${id}`);
    return data ? JSON.parse(data) : null;
  },
  saveSession: async (id: string, session: DiagnosticSession) => {
    if (!REDIS_ENABLED || !redisClient) return;
    await redisClient.set(`session:${id}`, JSON.stringify(session));
  }
};

