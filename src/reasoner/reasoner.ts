import type { Knowledge } from './knowledge.js';

export type Beliefs = Record<string, number>;

export function initializeBeliefs(kb: Knowledge, symptomIds: string[]): Beliefs {
  const b: Beliefs = {};
  for (const c of kb.causes) b[c.id] = c.prior;
  for (const edge of kb.edges.symptom_to_cause) {
    if (symptomIds.includes(edge.symptom)) {
      b[edge.cause] = clamp01((b[edge.cause] ?? 0) + 0.3 * edge.weight);
    }
  }
  normalize(b);
  return b;
}

export function updateBeliefsWithObservation(
  kb: Knowledge,
  beliefs: Beliefs,
  testId: string,
  observation: any
) {
  const abnormal = isAbnormal(kb, testId, observation);
  for (const link of kb.edges.cause_to_test) {
    if (link.test !== testId) continue;
    const delta = (abnormal ? +1 : -1) * 0.2 * link.discriminative;
    beliefs[link.cause] = clamp01((beliefs[link.cause] ?? 0) + delta);
  }
  normalize(beliefs);
}

export function selectNextTest(kb: Knowledge, beliefs: Beliefs, asked: Set<string>): string | null {
  const top = topNCauses(beliefs, 3);
  let bestTest: string | null = null;
  let bestScore = -Infinity;
  for (const link of kb.edges.cause_to_test) {
    if (!top.includes(link.cause)) continue;
    if (asked.has(link.test)) continue;
    const score = (beliefs[link.cause] || 0) * link.discriminative;
    if (score > bestScore) {
      bestScore = score; bestTest = link.test;
    }
  }
  return bestTest;
}

export function topCause(beliefs: Record<string, number>): { id: string | null; score: number } {
  let best: string | null = null; let bestScore = -1;
  for (const [id, score] of Object.entries(beliefs || {})) {
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return { id: best, score: bestScore < 0 ? 0 : bestScore };
}

// ------- helpers
function topNCauses(beliefs: Beliefs, n: number): string[] {
  return Object.entries(beliefs).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([id])=>id);
}

function isAbnormal(kb: Knowledge, testId: string, observation: any): boolean {
  const t = kb.tests.find(t => t.id === testId);
  if (!t) return false;
  const exp = t.expected || {};
  if (exp.type === 'boolean') return !!(typeof observation === 'string' ? observation.match(/(y|true|yes|1)/i) : observation);
  if (typeof observation === 'number') {
    if (typeof exp.normal_min === 'number' && observation < exp.normal_min) return true;
    if (typeof exp.normal_max === 'number' && observation > exp.normal_max) return true;
    return false;
  }
  const m = String(observation).match(/(\d+(\.\d+)?)/);
  if (m) {
    const val = parseFloat(m[1]);
    if (typeof exp.normal_min === 'number' && val < exp.normal_min) return true;
    if (typeof exp.normal_max === 'number' && val > exp.normal_max) return true;
    return false;
  }
  return false;
}

function normalize(b: Beliefs) {
  const sum = Object.values(b).reduce((a,c)=>a+c,0) || 1;
  for (const k of Object.keys(b)) b[k] = b[k]/sum;
}
function clamp01(x:number){ return Math.max(0, Math.min(1, x)); }
export function penalizeCause(beliefs: Beliefs, causeId: string, factor = 0.3) {
  if (beliefs[causeId] != null) beliefs[causeId] *= factor;
  normalize(beliefs);
}

