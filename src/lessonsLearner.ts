import fs from 'fs';
import path from 'path';
import type { DiagnosticSession } from './types';

const kbPath = path.resolve(__dirname, '../knowledge-base/fault_tree_library.json');

export async function captureLessons(session: DiagnosticSession) {
  if (!session.resolved) return;
  const lib = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  lib.lessons = lib.lessons || [];
  lib.lessons.push({ timestamp: new Date().toISOString(), symptom: session.symptomsConfirmed[0], tests: session.testResults, resolution: session.resolution, confidence: session.confidenceLevel });
  fs.writeFileSync(kbPath, JSON.stringify(lib, null, 2));
}