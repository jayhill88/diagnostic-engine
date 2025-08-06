import { Engine, RuleProperties } from 'json-rules-engine';
import fs from 'fs';
import path from 'path';

const lib = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../knowledge-base/fault_tree_library.json'), 'utf8'));

export async function runFaultTree(symptom: string, facts: Record<string, any>) {
  const tree = lib.faultTrees.find((f: any) => f.symptom === symptom);
  if (!tree) throw new Error(`No tree for symptom ${symptom}`);
  const engine = new Engine();
  tree.nodes.forEach((node: any) => {
    engine.addRule({
      conditions: { all: [{ fact: node.test, operator: node.operator, value: node.threshold }] },
      event: { type: node.ifTrue, params: { reason: node.id } }
    } as RuleProperties);
  });
  const results = await engine.run(facts);
  if (results.events.length) return { nextStep: results.events[0].type, reason: results.events[0].params.reason };
  return { nextStep: 'no_conclusion', reason: '' };
}