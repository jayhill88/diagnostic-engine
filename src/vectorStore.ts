import fs from 'fs';
import path from 'path';

const scenarioPath = path.join(process.cwd(), 'knowledge-base', 'Hydraulic_Scenarios_1_to_15.json');
const scenarios = fs.existsSync(scenarioPath) ? JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) : [];

export async function retrieveRelevantChunks(userInput: string): Promise<any[]> {
  if (!Array.isArray(scenarios)) return [];
  const input = (userInput || '').toLowerCase();
  return scenarios
    .map((s: any) => {
      const tags: string[] = Array.isArray(s.failure_mode_tags) ? s.failure_mode_tags : [];
      const matched = tags.filter(tag => input.includes(String(tag).toLowerCase()));
      return matched.length ? { ...s, matchScore: matched.length } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.matchScore - a.matchScore)
    .slice(0, 3);
}

