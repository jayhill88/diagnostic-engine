// src/sessionStore.ts
import Redis from 'ioredis';
import type { DiagnosticSession } from './types';

let redisClient: Redis | null = null;
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

if (REDIS_ENABLED) {
  redisClient = new Redis();
  redisClient.on('error', (err) => console.error('[Redis Error]', err));
}

// -- Helpers -------------------------------------------------------------

function makeDefaultSession(id: string): DiagnosticSession {
  const session: DiagnosticSession = {
    // legacy/UI fields (kept for compatibility)
    phase: '',
    confidenceLevel: 0,
    conversationHistory: [],
    symptomsConfirmed: [],
    testResults: [],

    // agentic RAG conversational state
    id,
    history: [],
    responses: {},
    stage: 'init',         
    questions: [],
    tags: []
  };

  // Sanity check log
  console.log(`[sessionStore] NEW session ${id}: stage=${session.stage}, q=${session.questions.length}, tags=${session.tags.length}`);
  return session;
}

function normalizeSession(id: string, raw: any): DiagnosticSession {
  const session: DiagnosticSession = {
    // legacy/UI
    phase: raw?.phase ?? '',
    confidenceLevel: raw?.confidenceLevel ?? 0,
    conversationHistory: Array.isArray(raw?.conversationHistory) ? raw.conversationHistory : [],
    symptomsConfirmed: Array.isArray(raw?.symptomsConfirmed) ? raw.symptomsConfirmed : [],
    testResults: Array.isArray(raw?.testResults) ? raw.testResults : [],

    // agentic RAG
    id,
    history: Array.isArray(raw?.history) ? raw.history : [],
    responses: typeof raw?.responses === 'object' && raw?.responses !== null ? raw.responses : {},
    stage: (raw?.stage as DiagnosticSession['stage']) ?? 'init',
    questions: Array.isArray(raw?.questions) ? raw.questions : [],
    tags: Array.isArray(raw?.tags) ? raw.tags : []
  };

  // Sanity check log
  console.log(
    `[sessionStore] LOAD session ${id}: stage=${session.stage}, ` +
    `q=${session.questions.length}, tags=${session.tags.length}, history=${session.history.length}`
  );

  return session;
}

// -- Store API -----------------------------------------------------------

export const sessionStore = {
  getSession: async (id: string): Promise<DiagnosticSession> => {
    // If Redis is disabled, return a transient in-memory default (per call)
    if (!REDIS_ENABLED || !redisClient) {
      return makeDefaultSession(id);
    }

    const key = `session:${id}`;
    const data = await redisClient.get(key);

    if (!data) {
      const fresh = makeDefaultSession(id);
      await redisClient.set(key, JSON.stringify(fresh));
      return fresh;
    }

    // Parse & normalize legacy sessions safely
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      console.warn(`[sessionStore] Corrupt JSON for ${key}, resetting.`, err);
      const fresh = makeDefaultSession(id);
      await redisClient.set(key, JSON.stringify(fresh));
      return fresh;
    }

    const normalized = normalizeSession(id, parsed);

    // Ensure normalized shape is persisted back (self-healing)
    await redisClient.set(key, JSON.stringify(normalized));
    return normalized;
  },

  saveSession: async (id: string, session: DiagnosticSession) => {
    if (!REDIS_ENABLED || !redisClient) {
      // No-op if Redis is disabled
      console.log(`[sessionStore] SAVE (noop, Redis disabled) ${id}: stage=${session.stage}, q=${session.questions.length}`);
      return;
    }

    const key = `session:${id}`;
    await redisClient.set(key, JSON.stringify(session));
    console.log(`[sessionStore] SAVE ${id}: stage=${session.stage}, q=${session.questions.length}, tags=${session.tags.length}`);
  }
};

