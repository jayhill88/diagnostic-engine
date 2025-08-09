export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface QuestionTurn {
  text: string;
  askedAt?: string;
  answeredAt?: string;
}

export interface DiagnosticSession {
  phase: string;
  confidenceLevel: number;
  conversationHistory: ChatMessage[];
  symptomsConfirmed: string[];
  testResults: [string, any][];

  id: string;
  history: string[];
  responses: Record<string, string>;
  stage: 'init' | 'gathering' | 'diagnosing' | 'proposing' | 'verifying' | 'awaiting_artifacts' | 'resolved' | 'fallback_llm';
  tags: string[];
  questions: QuestionTurn[];
  autoLoopCount?: number;

  // brain
  beliefs?: Record<string, number>;
  symptomIds?: string[];
  askedTests?: string[];
  pendingTestId?: string | null;

  // proposal/verification
  proposedCauseId?: string | null;
  proposedFix?: string | null;
  verificationPrompt?: string | null;
  triedCauses?: string[];
  resolutionAttempts?: number;

  // artifacts
  artifacts?: { id: string; kind: 'schematic' | 'photo' | 'pdf'; path: string }[];
  pendingArtifactKind?: 'schematic' | 'photo' | 'pdf' | null;
}

