import { runGraph } from '../packages/core/dist/index.js';

async function main() {
  const graph = {
    id: 'debug-catch',
    name: 'Debug Catch',
    version: '0.0.1',
    maxIterations: 2,
    nodes: [
      {
        id: 'op',
        name: 'Increment i',
        type: 'operation',
        operationAction: { op: 'inc', varName: 'i', amount: 1 },
      },
      {
        id: 'cond',
        name: 'Loop condition',
        type: 'condition',
        // Add an exit branch that never matches so SCC has an exit target for validation,
        // but in practice the loop will still hit maxIterations.
        branches: [
          { label: 'never', condition: { ref: 'vars.never', operator: 'exists' }, target: 'after' }
        ],
        defaultTarget: 'op',
      },
      {
        id: 'catch1',
        name: 'Catch Max',
        type: 'catch',
        catchTriggers: ['maxIterations'],
        resumePolicy: 'always',
      },
      {
        id: 'after',
        name: 'After Catch',
        type: 'operation',
        operationAction: { op: 'set', varName: 'done', value: true },
      },
      {
        id: 'output',
        name: 'Output',
        type: 'output',
      }
    ],
    edges: [
      { id: 'e1', source: 'op', target: 'cond' },
      // cond defaultTarget already points to op (branch), no edge needed for that routing
      { id: 'e2', source: 'catch1', target: 'after' },
      { id: 'e3', source: 'after', target: 'output' },
    ],
    initVars: { i: 0 }
  };

  try {
    const res = await runGraph(graph, {});
    console.log('RESULT', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  }
}

main().catch(err => console.error(err));
