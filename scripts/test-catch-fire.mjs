import fs from 'node:fs/promises';
import path from 'node:path';
import { runGraph } from '../packages/core/dist/index.js';

const p = path.resolve(process.env.USERPROFILE, '.nyteshift', 'graphs', 'graph-1773370695650.json');
const raw = await fs.readFile(p, 'utf8');
const graph = JSON.parse(raw);
const g = JSON.parse(JSON.stringify(graph));
g.maxIterations = 2;

for (const node of g.nodes) {
  if (node.type !== 'catch' && node.type !== 'input' && node.type !== 'output' && node.type !== 'condition' && node.type !== 'operation') {
    node.type = 'operation';
    node.operationAction = { op: 'error', message: 'forced error' };
  }
}

const res = await runGraph(g, {});
const catchResults = res.nodeResults.filter(r => ['catch-mmzccmmj','catch-mmzahtvr','catch-mmofz6iq'].includes(r.nodeId));
console.log('CATCH RESULTS:', JSON.stringify(catchResults.map(r => ({ id: r.nodeId, status: r.status, isPlaceholder: r.metadata?.__placeholder })), null, 2));
