import { OpenAI } from 'openai';
import type { DiagnosticSession, ChatMessage, InteractiveResponsePayload } from './types';
import { runFaultTree } from './faultTreeEngine';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateInteractiveDiagnosticResponse(
  userMessage: string,
  history: ChatMessage[],
  session: DiagnosticSession | null
): Promise<InteractiveResponsePayload & { session: DiagnosticSession }> {
  const symptom = session?.symptomsConfirmed[0] ?? 'unknown';
  const facts = Object.fromEntries(session?.testResults ?? []);
  const rule = await runFaultTree(symptom, facts);

  const systemPrompt = `You are an Industrial Hydraulic Diagnostician.\nNext step: ${rule.nextStep}` +
    (session ? `\nPhase: ${session.phase}` : '');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o', messages, temperature: 0.3, max_tokens: 1500, response_format: { type: 'json_object' }
  });

  const { message, quickActions, followUpQuestions, phase, confidence } = resp.choices[0].message.json;

  const newSession: DiagnosticSession = {
    ...(session ?? {}), phase, conversationHistory: [...(session?.conversationHistory ?? []), { role:'user', content: userMessage }, { role:'assistant', content: message }],
    symptomsConfirmed: [...(session?.symptomsConfirmed ?? []), ...quickActions.map(a => a.id)],
    testResults: session?.testResults ?? [], lastRuleDecision: rule, confidenceLevel: confidence
  };

  return { message, quickActions, followUpQuestions, phase, confidence, session: newSession };
}