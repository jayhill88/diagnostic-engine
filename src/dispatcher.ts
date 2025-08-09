import { runTroubleshootingAgent } from './agents/TroubleshootingAgent';

export async function dispatchAgent(userInput: string = '', sessionId: string) {
  const input = userInput?.toLowerCase() || '';

  if (input.includes('define') || input.includes('what is')) {
    return { agent: 'ReferenceAgent', response: "ReferenceAgent not yet implemented." };
  }

  const result = await runTroubleshootingAgent(userInput, sessionId);
  return { agent: 'TroubleshootingAgent', ...result };
}

