import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import type { DiagnosticSession } from './types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function generateInteractiveDiagnosticResponse(
  userMessage: string,
  history: any[],
  session: DiagnosticSession | null
) {
  const messages = [
    ...(history || []),
    { role: 'user', content: userMessage }
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages
  });

  const reply = response.choices[0].message.content;

  // Build a session object — this depends on your system
  const newSession: DiagnosticSession = {
    ...(session || {}),
    history: [...messages, { role: 'assistant', content: reply }]
  };

  return {
    session: newSession,
    reply
  };
}

export default openai;

