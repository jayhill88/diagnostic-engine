import fs from 'fs';
import path from 'path';

export type Symptom = { id: string; aliases: string[] };
export type Cause = { id: string; component: string; prior: number };
export type Test = {
  id: string;
  question: string;
  expected: any;
  safety?: string;
};
export type Edges = {
  symptom_to_cause: { symptom: string; cause: string; weight: number }[];
  cause_to_test: { cause: string; test: string; discriminative: number }[];
  cause_to_fix: { cause: string; fix: string }[];
};
export type Knowledge = { symptoms: Symptom[]; causes: Cause[]; tests: Test[]; edges: Edges };

function loadJSON<T>(rel: string): T {
  const p = path.join(process.cwd(), rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadKnowledge(): Knowledge {
  return {
    symptoms: loadJSON<Symptom[]>('knowledge/symptoms.json'),
    causes: loadJSON<Cause[]>('knowledge/causes.json'),
    tests: loadJSON<Test[]>('knowledge/tests.json'),
    edges: loadJSON<Edges>('knowledge/edges.json')
  };
}

export function classifySymptoms(freeText: string, kb: Knowledge): string[] {
  const t = (freeText || '').toLowerCase();
  const hits: string[] = [];
  for (const s of kb.symptoms) {
    if (s.aliases.some(a => t.includes(a.toLowerCase()))) hits.push(s.id);
  }
  return Array.from(new Set(hits));
}

