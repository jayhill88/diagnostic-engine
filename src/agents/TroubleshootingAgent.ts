import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Missing OPENAI_API_KEY. Add it to your .env and restart.');
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

import fs from 'fs';
import path from 'path';


import { sessionStore } from '../sessionStore.js';
import type { DiagnosticSession, QuestionTurn } from '../types.js';
import { retrieveRelevantChunks } from '../vectorStore.js';
import { CLARIFYING_QUESTION_BANK } from './clarifyingQuestions.js';
import { loadKnowledge, classifySymptoms } from '../reasoner/knowledge.js';
import { initializeBeliefs, updateBeliefsWithObservation, selectNextTest, topCause, penalizeCause } from '../reasoner/reasoner.js';

const openai = getOpenAI();

const KB = loadKnowledge();

const MAX_MODEL_LOOPS = 3;
const EARLY_CONFIDENCE_THRESHOLD = 0.7;
const LOW_CONFIDENCE_THRESHOLD = 0.45;

function nowISO() { return new Date().toISOString(); }

async function getModelSuggestion(prompt: string) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0]?.message?.content ?? "";
}





function ensureShape(session: DiagnosticSession) {
  session.stage = session.stage || 'init';
  session.history = session.history || [];
  session.responses = session.responses || {};
  session.tags = Array.isArray(session.tags) ? session.tags : [];
  session.questions = Array.isArray(session.questions) ? session.questions.map(q => typeof (q as any) === 'string' ? ({ text: q as any }) : q) : 
[];
  session.autoLoopCount = typeof session.autoLoopCount === 'number' ? session.autoLoopCount : 0;
  session.beliefs = session.beliefs || {};
  session.symptomIds = session.symptomIds || [];
  session.askedTests = session.askedTests || [];
  session.pendingTestId = session.pendingTestId ?? null;
  session.triedCauses = session.triedCauses || [];
  session.resolutionAttempts = session.resolutionAttempts ?? 0;
  session.artifacts = session.artifacts || [];
  session.pendingArtifactKind = session.pendingArtifactKind ?? null;
}

function recordAnswerAndNextQuestion(session: DiagnosticSession, userText: string): { next?: QuestionTurn; done: boolean } {
  const unansweredIdx = session.questions.findIndex(q => !q.answeredAt);
  if (unansweredIdx !== -1) {
    const q = session.questions[unansweredIdx];
    q.answeredAt = nowISO();
    session.responses[q.text] = (userText ?? '').toString().trim();
  }
  const nextIdx = session.questions.findIndex(q => !q.answeredAt);
  if (nextIdx !== -1) {
    const next = session.questions[nextIdx];
    if (!next.askedAt) next.askedAt = nowISO();
    return { next, done: false };
  }
  return { done: true };
}

function parseYesNo(text: string): 'yes' | 'no' | 'unknown' {
  const t = (text || '').trim().toLowerCase();
  if (/^(y|yes|yep|yeah|resolved|fixed|works)/i.test(t)) return 'yes';
  if (/^(n|no|nope|not yet|didn'?t|still)/i.test(t)) return 'no';
  return 'unknown';
}

async function analyzeSchematic(absPath: string) {
  // Best-effort v0.1: use base64 data URL; if the model can’t read it, we fail softly.
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/pdf';
  const buf = fs.readFileSync(absPath);
  const b64 = buf.toString('base64');
  const url = `data:${mime};base64,${b64}`;

  const system = `You are reading a hydraulic schematic. Return ONLY minified JSON:
{"components":[{"label":string,"type":string}], "connections":[[string,string], ...]}
Types: pump, relief_valve, check_valve, filter, pressure_line, return_line, manifold, directional_valve, cylinder, motor, accumulator, cooler, 
pressure_gauge.`;

  try {
      const openai = getOpenAI();
      const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
            { type: 'text', text: 'Extract components and connections.' } as any,
            { type: 'image_url', image_url: { url } } as any
          ] as any
        }
      ]
    });
    return JSON.parse(resp.choices?.[0]?.message?.content || '{}');
  } catch {
    return { components: [], connections: [] };
  }
}

function classifySymptomTags(input: string): string[] {
  const t = (input || '').toLowerCase();
  const tags: string[] = [];
  if (t.includes('slow')) tags.push('slow_cylinder');
  if (t.includes('under load')) tags.push('under_load');
  if (t.includes('hot') || t.includes('overheat')) tags.push('overheating');
  return Array.from(new Set(tags));
}

function formatScenarioContext(scenarios: any[]): string {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return 'No matching scenarios.';
  return scenarios.slice(0, 3).map((s: any, i: number) => {
    const lines: string[] = [];
    lines.push(`Scenario ${i + 1}: ${s.title ?? s.scenario_id ?? 'Unknown'}`);
    if (s.description) lines.push(`  Description: ${s.description}`);
    if (Array.isArray(s.symptoms) && s.symptoms.length) lines.push(`  Symptoms: ${s.symptoms.join('; ')}`);
    if (Array.isArray(s.questions) && s.questions.length) lines.push(`  Questions: ${s.questions.join(' | ')}`);
    if (Array.isArray(s.steps) && s.steps.length) lines.push(`  Steps: ${s.steps.join(' -> ')}`);
    if (s.root_cause) lines.push(`  Root Cause: ${s.root_cause}`);
    if (s.solution) lines.push(`  Solution: ${s.solution}`);
    if (Array.isArray(s.failure_mode_tags) && s.failure_mode_tags.length) lines.push(`  Tags: ${s.failure_mode_tags.join(', ')}`);
    return lines.join('\n');
  }).join('\n---\n');
}

export async function handleTroubleshootingMessage(userText: string, sessionId: string, reqBody?: any) {
  let session = await sessionStore.getSession(sessionId);
  ensureShape(session);
  session.history.push(userText);
  console.log(`[Agent] session=${sessionId} stage=${session.stage} user="${userText}" loops=${session.autoLoopCount}`);

  // Reset (dev convenience)
  if ((userText || '').trim().toLowerCase() === 'reset') {
    await sessionStore.resetSession(sessionId);
    return { status: 'reset', sessionId };
  }

  // ==== Awaiting artifacts
  if (session.stage === 'awaiting_artifacts') {
    const artifactId = (reqBody?.artifactId || '').trim?.();
    if (!artifactId) {
      return {
        status: 'need_artifact',
        stage: session.stage,
        request: 'Artifact ID missing. Please upload via /upload and resend.'
      };
    }
    const absPath = path.join(process.cwd(), 'uploads', artifactId);
    if (!fs.existsSync(absPath)) {
      return { status: 'need_artifact', stage: session.stage, request: 'File not found on server. Please re-upload.' };
    }
    const parsed = await analyzeSchematic(absPath);
    // simple heuristic: boost causes if path mentions components
    const hasRelief = parsed.components?.some((c: any) => /relief/i.test(c.type));
    const hasCylinder = parsed.components?.some((c: any) => /cylinder/i.test(c.type));
    if (hasRelief) session.beliefs!['relief_misadjusted'] = (session.beliefs!['relief_misadjusted'] || 0) + 0.1;
    if (hasCylinder) session.beliefs!['load_excessive'] = (session.beliefs!['load_excessive'] || 0) + 0.05;

    // back to gathering with next best test
    session.stage = 'gathering';
    session.pendingArtifactKind = null;
    await sessionStore.saveSession(sessionId, session);
    const next = selectNextTest(KB, session.beliefs!, new Set(session.askedTests));
    if (next) {
      session.pendingTestId = next; await sessionStore.saveSession(sessionId, session);
      const t = KB.tests.find(t => t.id === next)!;
      return { status: 'continue', stage: 'gathering', next_question: t.question };
    }
    // no test → try confidence gate
    const { id: bestId0, score: bestScore0 } = topCause(session.beliefs!);
    if (bestId0 && bestScore0 >= EARLY_CONFIDENCE_THRESHOLD) {
      const fix = KB.edges.cause_to_fix.find(f => f.cause === bestId0)?.fix || null;
      session.stage = 'proposing';
      session.proposedCauseId = bestId0;
      session.proposedFix = fix;
      session.verificationPrompt = 'Did that resolve the issue? (yes/no)';
      await sessionStore.saveSession(sessionId, session);
      const confTest = KB.edges.cause_to_test.filter(l => l.cause === bestId0).sort((a,b)=>b.discriminative-a.discriminative)[0];
      const confStep = confTest ? (KB.tests.find(t => t.id === confTest.test)?.question || '') : 'Confirm readings match spec.';
      return {
        status: 'proposed_fix',
        stage: 'verifying',
        cause: bestId0,
        diagnostic_steps: [ `Confirm: ${confStep}` ],
        recommended_solution: fix,
        verify: session.verificationPrompt,
        confidence: Number(bestScore0.toFixed(2))
      };
    }
    // still not confident → go diagnose presenter
    session.stage = 'diagnosing';
    await sessionStore.saveSession(sessionId, session);
  }

  // ==== INIT
  if (session.stage === 'init') {
    const tags = classifySymptomTags(userText);
    session.tags = tags;
    const symptomIds = classifySymptoms(userText, KB);
    session.symptomIds = symptomIds;
    session.beliefs = initializeBeliefs(KB, symptomIds);
    session.askedTests = [];

    // choose next test from brain
    const nextTest = selectNextTest(KB, session.beliefs, new Set(session.askedTests));
    if (nextTest) {
      session.pendingTestId = nextTest;
      session.stage = 'gathering';
      await sessionStore.saveSession(sessionId, session);
      const t = KB.tests.find(t => t.id === nextTest)!;
      return { status: 'continue', stage: 'gathering', next_question: t.question };
    }

    // no test → if confidence high, propose; else diagnose/fallback
    const { id: bestId, score: bestScore } = topCause(session.beliefs);
    if (bestId && bestScore >= EARLY_CONFIDENCE_THRESHOLD) {
      const fix = KB.edges.cause_to_fix.find(f => f.cause === bestId)?.fix || null;
      session.stage = 'proposing';
      session.proposedCauseId = bestId;
      session.proposedFix = fix;
      session.verificationPrompt = 'Did that resolve the issue? (yes/no)';
      await sessionStore.saveSession(sessionId, session);
      const confTest = KB.edges.cause_to_test.filter(l => l.cause === bestId).sort((a,b)=>b.discriminative-a.discriminative)[0];
      const confStep = confTest ? (KB.tests.find(t => t.id === confTest.test)?.question || '') : 'Confirm readings match spec.';
      return {
        status: 'proposed_fix',
        stage: 'verifying',
        cause: bestId,
        diagnostic_steps: [ `Confirm: ${confStep}` ],
        recommended_solution: fix,
        verify: session.verificationPrompt,
        confidence: Number(bestScore.toFixed(2))
      };
    }

    // low confidence → ask for schematic before LLM
    if ((bestScore ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
      session.stage = 'awaiting_artifacts';
      session.pendingArtifactKind = 'schematic';
      await sessionStore.saveSession(sessionId, session);
      return {
        status: 'need_artifact',
        stage: session.stage,
        request: 'Please upload the hydraulic schematic that includes the affected loop (pump → relief → control/manifold → actuatorreturn).',
        upload_endpoint: '/upload',
        accept: ['image/png','image/jpeg','application/pdf'],
        tips: [
          'Include the relief valve section and case-drain path.',
          'If you have multiple sheets, upload the one with the actuator circuit.'
        ]
      };
    }

    session.stage = 'diagnosing';
    await sessionStore.saveSession(sessionId, session);
  }

  // ==== GATHERING
  if (session.stage === 'gathering') {
    // brain test path
    if (session.pendingTestId) {
      updateBeliefsWithObservation(KB, session.beliefs!, session.pendingTestId, userText);
      session.askedTests!.push(session.pendingTestId);
      session.pendingTestId = null;

      // early exit if confident
      const { id: bestId, score: bestScore } = topCause(session.beliefs!);
      if (bestId && bestScore >= EARLY_CONFIDENCE_THRESHOLD) {
        const fix = KB.edges.cause_to_fix.find(f => f.cause === bestId)?.fix || null;
        session.stage = 'proposing';
        session.proposedCauseId = bestId;
        session.proposedFix = fix;
        session.verificationPrompt = 'Did that resolve the issue? (yes/no)';
        await sessionStore.saveSession(sessionId, session);
        const confTest = KB.edges.cause_to_test.filter(l => l.cause === bestId).sort((a,b)=>b.discriminative-a.discriminative)[0];
        const confStep = confTest ? (KB.tests.find(t => t.id === confTest.test)?.question || '') : 'Confirm readings match spec.';
        return {
          status: 'proposed_fix',
          stage: 'verifying',
          cause: bestId,
          diagnostic_steps: [ `Confirm: ${confStep}` ],
          recommended_solution: fix,
          verify: session.verificationPrompt,
          confidence: Number(bestScore.toFixed(2))
        };
      }

      // pick another test
      const next = selectNextTest(KB, session.beliefs!, new Set(session.askedTests));
      if (next) {
        session.pendingTestId = next; await sessionStore.saveSession(sessionId, session);
        const t = KB.tests.find(t => t.id === next)!;
        return { status: 'continue', stage: 'gathering', next_question: t.question };
      }

      // if no next test:
      if ((bestScore ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
        session.stage = 'awaiting_artifacts';
        session.pendingArtifactKind = 'schematic';
        await sessionStore.saveSession(sessionId, session);
        return {
          status: 'need_artifact',
          stage: session.stage,
          request: 'Please upload the hydraulic schematic for this loop. Mark suspected components if possible.',
          upload_endpoint: '/upload',
          accept: ['image/png','image/jpeg','application/pdf'],
          tips: ['Include relief valve section and case-drain path.']
        };
      }

      session.stage = 'diagnosing';
      await sessionStore.saveSession(sessionId, session);
    } else {
      // legacy bank fallback (if you want to keep it)
      const { next, done } = recordAnswerAndNextQuestion(session, userText);
      if (!done && next) {
        await sessionStore.saveSession(sessionId, session);
        return { status: 'continue', stage: session.stage, next_question: next.text };
      }
      session.stage = 'diagnosing';
      await sessionStore.saveSession(sessionId, session);
    }
  }

  // ==== VERIFYING (user answering yes/no)
  if (session.stage === 'verifying' || session.stage === 'proposing') {
    const yn = parseYesNo(userText);
    if (yn === 'yes') {
      session.stage = 'resolved';
      await sessionStore.saveSession(sessionId, session);
      return {
        status: 'diagnosis',
        stage: 'resolved',
        result: {
          clarifying_questions: [],
          diagnostic_steps: [],
          likely_cause: session.proposedCauseId,
          recommended_solution: session.proposedFix,
          failure_mode_tags: [session.proposedCauseId || ''],
          confidence: Number((topCause(session.beliefs || {}).score || 0).toFixed(2)),
          rationale: 'User confirmed resolution.'
        }
      };
    }
    if (yn === 'no') {
      // penalize and loop
      if (session.proposedCauseId) penalizeCause(session.beliefs!, session.proposedCauseId, 0.3);
      session.triedCauses!.push(session.proposedCauseId || '');
      session.resolutionAttempts = (session.resolutionAttempts || 0) + 1;
      session.proposedCauseId = null; session.proposedFix = null; session.verificationPrompt = null;

      // try another high-confidence cause
      const { id: nextId, score: nextScore } = topCause(session.beliefs!);
      if (nextId && nextScore >= EARLY_CONFIDENCE_THRESHOLD) {
        const fix = KB.edges.cause_to_fix.find(f => f.cause === nextId)?.fix || null;
        session.stage = 'proposing'; session.proposedCauseId = nextId; session.proposedFix = fix;
        session.verificationPrompt = 'Did that resolve the issue? (yes/no)';
        await sessionStore.saveSession(sessionId, session);
        const confTest = KB.edges.cause_to_test.filter(l => l.cause === nextId).sort((a,b)=>b.discriminative-a.discriminative)[0];
        const confStep = confTest ? (KB.tests.find(t => t.id === confTest.test)?.question || '') : 'Confirm readings match spec.';
        return {
          status: 'proposed_fix',
          stage: 'verifying',
          cause: nextId,
          diagnostic_steps: [ `Confirm: ${confStep}` ],
          recommended_solution: session.proposedFix,
          verify: session.verificationPrompt,
          confidence: Number(nextScore.toFixed(2))
        };
      }

      // otherwise, go back to gathering with best next test
      const next = selectNextTest(KB, session.beliefs!, new Set(session.askedTests));
      if (next) {
        session.pendingTestId = next; session.stage = 'gathering';
        await sessionStore.saveSession(sessionId, session);
        const t = KB.tests.find(t => t.id === next)!;
        return { status: 'continue', stage: 'gathering', next_question: t.question };
      }

      // last resort → diagnosing (presenter)
      session.stage = 'diagnosing';
      await sessionStore.saveSession(sessionId, session);
    }

    // unknown response → re-ask
    return { status: 'continue', stage: 'verifying', next_question: 'Did that resolve the issue? (yes/no)' };
  }

  // ==== DIAGNOSING (Presenter LLM)
  if (session.stage === 'diagnosing') {
    try {
      const contextLines = Object.entries(session.responses || {}).map(([q, a]) => `Q: ${q}\nA: ${a}`);
      const userAndAnswersContext = contextLines.join('\n');

      const scenarios = await retrieveRelevantChunks(userText + '\n' + userAndAnswersContext);
      const scenarioContext = formatScenarioContext(scenarios);

      const topCauses = Object.entries(session.beliefs || {})
        .sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([id,score]) => `${id}: ${score.toFixed(2)}`).join('\n');

      const system = `You are a hydraulic diagnostics expert.
Return ONLY strict minified JSON with this schema (no markdown, no extra text):
{
  "clarifying_questions": string[],
  "diagnostic_steps": string[],
  "likely_cause": string|null,
  "recommended_solution": string|null,
  "failure_mode_tags": string[],
  "confidence": number
}
Rules:
- Use the signals and retrieved scenarios to craft targeted checks.
- Steps must be concrete: specify port, tool, expected values, and decision criteria.
- If overall confidence < 0.6, set likely_cause to null and include 2–3 clarifying_questions.
- Do not hallucinate specifications. If unknown, ask for the spec or cite a general check.`;

      const userPrompt = `
Issue: ${userText}

Brain context (top candidates):
${topCauses || 'none'}

Prior answers:
${userAndAnswersContext || 'None'}

Relevant knowledge:
${scenarioContext}
`.trim();
      const openai = getOpenAI();
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      });

      const raw = completion?.choices?.[0]?.message?.content || '{}';
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch {
        parsed = { clarifying_questions: [], diagnostic_steps: [], likely_cause: null, recommended_solution: null, failure_mode_tags: [], 
confidence: 0.0, raw_text: raw };
      }

      const modelQs: string[] = Array.isArray(parsed.clarifying_questions) ? parsed.clarifying_questions : [];
      const canAutoLoop = (session.autoLoopCount || 0) < MAX_MODEL_LOOPS;

      if (modelQs.length > 0 && canAutoLoop) {
        const existing = new Set(session.questions.map(q => q.text));
        for (const q of modelQs) if (q && !existing.has(q)) session.questions.push({ text: q });
        const nextIdx = session.questions.findIndex(q => !q.answeredAt);
        if (nextIdx !== -1) {
          session.autoLoopCount = (session.autoLoopCount || 0) + 1;
          session.stage = 'gathering';
          if (!session.questions[nextIdx].askedAt) session.questions[nextIdx].askedAt = nowISO();
          await sessionStore.saveSession(sessionId, session);
          return { status: 'continue', stage: 'gathering', next_question: session.questions[nextIdx].text };
        }
      }

      // Low confidence → ask for schematic (artifact)
      if ((parsed.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
        session.stage = 'awaiting_artifacts';
        session.pendingArtifactKind = 'schematic';
        await sessionStore.saveSession(sessionId, session);
        return {
          status: 'need_artifact',
          stage: session.stage,
          request: 'Confidence is low. Please upload the hydraulic schematic that includes this loop.',
          upload_endpoint: '/upload',
          accept: ['image/png','image/jpeg','application/pdf'],
          tips: ['Include relief valve section and case-drain path.']
        };
      }

      // Otherwise finalize
      session.stage = 'resolved';
      await sessionStore.saveSession(sessionId, session);
      return { status: 'diagnosis', stage: 'resolved', result: parsed };

    } catch (err: any) {
      console.error('[Agent] Diagnosing error:', err?.message || err);
      return { status: 'error', stage: session.stage, error: err?.message || String(err) };
    }
  }

  console.warn(`[Agent] Unhandled session stage: ${session.stage}`);
  return { status: 'error', stage: session.stage, message: 'Unhandled session stage.' };
}

