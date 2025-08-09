import Redis from 'ioredis';
import type { DiagnosticSession } from './types.js';

const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';
const mem = new Map<string, DiagnosticSession>();

let redis: Redis | null = null;
if (REDIS_ENABLED) {
  const url = process.env.REDIS_URL;
  redis = url ? new Redis(url) : new Redis();
  redis.on('error', (e) => console.error('[Redis]', e));
}

function makeDefault(id: string): DiagnosticSession {
  return {
    phase: '',
    confidenceLevel: 0,
    conversationHistory: [],
    symptomsConfirmed: [],
    testResults: [],
    id,
    history: [],
    responses: {},
    stage: 'init',
    tags: [],
    questions: [],
    autoLoopCount: 0,
    beliefs: {},
    symptomIds: [],
    askedTests: [],
    pendingTestId: null,
    proposedCauseId: null,
    proposedFix: null,
    verificationPrompt: null,
    triedCauses: [],
    resolutionAttempts: 0,
    artifacts: [],
    pendingArtifactKind: null
  };
}

function normalize(id: string, raw: any): DiagnosticSession {
  const asQ = (q: any) => typeof q === 'string' ? ({ text: q }) : q;
  return {
    phase: raw?.phase ?? '',
    confidenceLevel: raw?.confidenceLevel ?? 0,
    conversationHistory: Array.isArray(raw?.conversationHistory) ? raw.conversationHistory : [],
    symptomsConfirmed: Array.isArray(raw?.symptomsConfirmed) ? raw.symptomsConfirmed : [],
    testResults: Array.isArray(raw?.testResults) ? raw.testResults : [],
    id,
    history: Array.isArray(raw?.history) ? raw.history : [],
    responses: raw?.responses && typeof raw.responses === 'object' ? raw.responses : {},
    stage: (raw?.stage as DiagnosticSession['stage']) ?? 'init',
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    questions: Array.isArray(raw?.questions) ? raw.questions.map(asQ) : [],
    autoLoopCount: typeof raw?.autoLoopCount === 'number' ? raw.autoLoopCount : 0,
    beliefs: raw?.beliefs && typeof raw.beliefs === 'object' ? raw.beliefs : {},
    symptomIds: Array.isArray(raw?.symptomIds) ? raw.symptomIds : [],
    askedTests: Array.isArray(raw?.askedTests) ? raw.askedTests : [],
    pendingTestId: raw?.pendingTestId ?? null,
    proposedCauseId: raw?.proposedCauseId ?? null,
    proposedFix: raw?.proposedFix ?? null,
    verificationPrompt: raw?.verificationPrompt ?? null,
    triedCauses: Array.isArray(raw?.triedCauses) ? raw.triedCauses : [],
    resolutionAttempts: typeof raw?.resolutionAttempts === 'number' ? raw.resolutionAttempts : 0,
    artifacts: Array.isArray(raw?.artifacts) ? raw.artifacts : [],
    pendingArtifactKind: raw?.pendingArtifactKind ?? null
  };
}

export const sessionStore = {
  async getSession(id: string): Promise<DiagnosticSession> {
    if (!REDIS_ENABLED || !redis) {
      const s = mem.get(id) ?? makeDefault(id);
      mem.set(id, s);
      return s;
    }
    const key = `session:${id}`;
    const data = await redis.get(key);
    if (!data) {
      const s = makeDefault(id);
      await redis.set(key, JSON.stringify(s));
      return s;
    }
    const parsed = normalize(id, JSON.parse(data));
    await redis.set(key, JSON.stringify(parsed));
    return parsed;
  },

  async saveSession(id: string, session: DiagnosticSession) {
    if (!REDIS_ENABLED || !redis) { mem.set(id, session); return; }
    const key = `session:${id}`;
    await redis.set(key, JSON.stringify(session));
  },

  async resetSession(id: string) {
    if (!REDIS_ENABLED || !redis) { mem.delete(id); return; }
    await redis.del(`session:${id}`);
  }
};

