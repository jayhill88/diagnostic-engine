export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InteractiveResponsePayload {
  message: string;
  quickActions: { id: string; label: string }[];
  followUpQuestions: { id: string; question: string }[];
  phase: string;
}

export interface DiagnosticSession {
  phase: string;
  confidenceLevel: number;
  conversationHistory: ChatMessage[];
  symptomsConfirmed: string[];
  testResults: [string, any][];

  id: string;                                // session id
  history: string[];                         // raw message history
  responses: Record<string, string>;         // answers to agent’s clarifying questions
  stage: 'gathering' | 'diagnosing' | 'resolved';  // diagnostic progress tracker
}

