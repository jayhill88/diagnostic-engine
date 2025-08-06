# Diagnostic Engine Repository Scaffold

Below is a complete scaffold for your standalone **diagnostic-engine** repo. You can copy these files into a new GitHub repository (or use ChatGPT’s GitHub integration to push them directly), then point your Replit frontend at it.

```
diagnostic-engine/
├── knowledge-base/
│   └── fault_tree_library.json
├── src/
│   ├── index.ts
│   ├── sessionStore.ts
│   ├── faultTreeEngine.ts
│   ├── openaiService.ts
│   └── lessonsLearner.ts
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 1. `.env.example`

```dotenv
# Rename to .env and fill in
dotenv_config_path=./.env
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

---

## 2. `package.json`

```json
{
  "name": "diagnostic-engine",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "dotenv": "^10.0.0",
    "express": "^4.18.2",
    "ioredis": "^5.3.2",
    "json-rules-engine": "^6.3.3",
    "openai": "^4.4.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.14",
    "@types/node": "^18.11.9",
    "ts-node-dev": "^2.0.0",
    "typescript": "^4.8.4"
  }
}
```

---

## 3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

---

## 4. `README.md`

````md
# Diagnostic Engine

A standalone Node.js + TypeScript service for interactive hydraulic diagnostics.

## Setup

```bash
git clone <repo-url>
cd diagnostic-engine
cp .env.example .env
npm install
npm run dev
````

## API

- **POST** `/message`
  - Body: `{ text: string, history: Array<{role,content}> }`
  - Response: `{ message, quickActions, followUpQuestions, phase, confidence }`

## Directory Structure

- `knowledge-base/` – JSON fault trees
- `src/` – TypeScript source
  - `index.ts` – Express server
  - `sessionStore.ts` – Redis-backed sessions
  - `faultTreeEngine.ts` – JSON-rules engine wrapper
  - `openaiService.ts` – OpenAI orchestration
  - `lessonsLearner.ts` – KB update logic

````

---

## 5. `knowledge-base/fault_tree_library.json`
```json
{
  "faultTrees": [
    {
      "id": "FT001",
      "symptom": "slow_actuation",
      "nodes": [
        {
          "id": "FT001-1",
          "test": "measure_flow_rate",
          "operator": "<",
          "threshold": 5,
          "ifTrue": "FT001-LOW_PUMP",
          "ifFalse": "FT002"
        }
      ]
    }
    // add more
  ],
  "lessons": []
}
````

---

## 6. `src/index.ts`

```ts
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import messageRouter from './routes/message';

dotenv.config();
const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/message', messageRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Diagnostic engine listening on port ${port}`);
});
```

---

## 7. `src/sessionStore.ts`

```ts
import { createClient } from 'ioredis';
import type { DiagnosticSession } from './types';

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', console.error);
await redis.connect();

export interface SessionStore {
  getSession(id: string): Promise<DiagnosticSession | null>;
  saveSession(id: string, session: DiagnosticSession): Promise<void>;
}

export class RedisSessionStore implements SessionStore {
  async getSession(id: string) {
    const data = await redis.get(`session:${id}`);
    return data ? JSON.parse(data) as DiagnosticSession : null;
  }

  async saveSession(id: string, session: DiagnosticSession) {
    await redis.set(`session:${id}`, JSON.stringify(session));
  }
}

export const sessionStore = new RedisSessionStore();
```

---

## 8. `src/faultTreeEngine.ts`

```ts
import { Engine, RuleProperties } from 'json-rules-engine';
import fs from 'fs';
import path from 'path';

// Load fault-tree JSON
const libPath = path.resolve(__dirname, '../knowledge-base/fault_tree_library.json');
const faultLib = JSON.parse(fs.readFileSync(libPath, 'utf8'));

export async function runFaultTree(
  symptom: string,
  facts: Record<string, any>
): Promise<{ nextStep: string; reason: string }> {
  const tree = faultLib.faultTrees.find((f: any) => f.symptom === symptom);
  if (!tree) throw new Error(`No fault tree for symptom ${symptom}`);

  const engine = new Engine();
  tree.nodes.forEach((node: any) => {
    const rule: RuleProperties = {
      conditions: {
        all: [{ fact: node.test, operator: node.operator, value: node.threshold }]
      },
      event: { type: node.ifTrue, params: { reason: node.id } }
    };
    engine.addRule(rule);
  });

  const results = await engine.run(facts);
  if (results.events.length > 0) {
    const ev = results.events[0];
    return { nextStep: ev.type, reason: ev.params.reason };
  }
  return { nextStep: 'no_conclusion', reason: '' };
}
```

---

## 9. `src/openaiService.ts`

```ts
import { OpenAI } from 'openai';
import type { DiagnosticSession, ChatMessage, InteractiveResponsePayload } from './types';
import { runFaultTree } from './faultTreeEngine';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateInteractiveDiagnosticResponse(
  userMessage: string,
  history: ChatMessage[],
  session: DiagnosticSession | null
): Promise<InteractiveResponsePayload & { session: DiagnosticSession }> {
  // 1. Determine current symptom & facts
  const symptom = session?.symptomsConfirmed[0] ?? 'unknown';
  const facts = Object.fromEntries(session?.testResults ?? []);
  const ruleResult = await runFaultTree(symptom, facts);

  // 2. Build prompt
  let systemPrompt = `You are an Industrial Hydraulic Diagnostician.\nNext logical step based on rules: ${ruleResult.nextStep}`;
  if (session) {
    systemPrompt += '\nCurrent phase: ' + session.phase;
  }

  // 3. Compose messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  // 4. Call OpenAI
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o', messages, temperature:0.3, max_tokens:1500,
    response_format:{type:'json_object'}
  });

  const { message, quickActions, followUpQuestions, phase, confidence } = resp.choices[0].message.json;

  // 5. Build updated session
  const newSession: DiagnosticSession = {
    ...session,
    phase,
    !!testResults?: session?.testResults ?? {},
    conversationHistory: [
      ...(session?.conversationHistory ?? []),
      { role:'user', content: userMessage },
      { role:'assistant', content: message }
    ],
    // track rule decisions
    lastRuleDecision: ruleResult,
    confidenceLevel: confidence
  };

  return { message, quickActions, followUpQuestions, phase, confidence, session: newSession };
}
```

---

## 10. `src/lessonsLearner.ts`

```ts
import fs from 'fs';
import path from 'path';
import type { DiagnosticSession } from './types';

const kbPath = path.resolve(__dirname, '../knowledge-base/fault_tree_library.json');

export async function captureLessons(session: DiagnosticSession) {
  if (!session.resolved) return;
  const lib = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  const lesson = {
    timestamp: new Date().toISOString(),
    symptom: session.symptomsConfirmed[0],
    tests: session.testResults,
    resolution: session.resolution,
    confidence: session.confidenceLevel
  };
  lib.lessons.push(lesson);
  fs.writeFileSync(kbPath, JSON.stringify(lib, null, 2));
}
```

---

Copy each file into your GitHub repo, install dependencies, and you’re ready to run your offline diagnostic engine. Once pushed, you can link this repo to Replit or any other front-end. Good luck!

