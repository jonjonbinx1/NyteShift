/**
 * Self-contained test for the multi-pass runLoopSCC fix.
 *
 * Constructs a synthetic graph with the exact same merge-point topology as
 * "Sort Critical": a condition with two paths (short and long) that converge
 * on a merge-point condition. The BFS withinOrder places the merge-point
 * BEFORE the long-path nodes, so without multi-pass it would be skipped.
 *
 * Topology (all operation/condition nodes — no external tools/LLMs):
 *
 *   input → op-start → cond-branch
 *                         ├── (short: flag=true)  → cond-merge
 *                         └── (long:  flag=false) → op-long1 → op-long2 → cond-merge
 *                                                      cond-merge
 *                                                        ├── (loop: page < 3)  → op-inc → op-start  (back-edge)
 *                                                        └── (done: page >= 3) → output             (exit)
 *
 * BFS withinOrder from op-start:
 *   0: op-start
 *   1: cond-branch
 *   2: cond-merge   ← merge point (position 2, but only reachable via long path at pos 5)
 *   3: op-long1
 *   4: op-inc
 *   5: op-long2
 *
 * With flag=false (long path), a single-pass scan would skip cond-merge (pos 2)
 * because it only becomes reachable after op-long2 (pos 5).
 */
import { runGraph } from '../packages/core/dist/index.js';

const graph = {
  id: 'test-multipass',
  name: 'Multi-Pass Test',
  description: 'Synthetic test for SCC merge-point ordering',
  version: '1.0.0',
  initVars: { page: 1, flag: false },
  maxIterations: 5,
  nodes: [
    { id: 'input-1', name: 'Input', type: 'input' },
    { id: 'output-1', name: 'Output', type: 'output' },
    {
      id: 'op-start',
      name: 'Start',
      type: 'operation',
      operationAction: { op: 'set', varName: 'started', value: true },
    },
    {
      id: 'cond-branch',
      name: 'Branch',
      type: 'condition',
      branches: [
        {
          label: 'Short',
          condition: { ref: 'vars.flag', operator: 'eq', value: true, valueType: 'boolean' },
          target: 'cond-merge',
        },
        {
          label: 'Long',
          condition: { ref: 'vars.flag', operator: 'eq', value: false, valueType: 'boolean' },
          target: 'op-long1',
        },
      ],
    },
    {
      id: 'op-long1',
      name: 'LongPath1',
      type: 'operation',
      operationAction: { op: 'set', varName: 'counter', value: 1 },
    },
    {
      id: 'op-long2',
      name: 'LongPath2',
      type: 'operation',
      operationAction: { op: 'set', varName: 'processed', value: true },
    },
    {
      id: 'cond-merge',
      name: 'MergePoint',
      type: 'condition',
      branches: [
        {
          label: 'Loop',
          condition: { ref: 'vars.page', operator: 'lt', value: 3, valueType: 'number' },
          target: 'op-inc',
        },
        {
          label: 'Done',
          condition: { ref: 'vars.page', operator: 'gte', value: 3, valueType: 'number' },
          target: 'output-1',
        },
      ],
    },
    {
      id: 'op-inc',
      name: 'Increment',
      type: 'operation',
      operationAction: { op: 'inc', varName: 'page', amount: 1 },
    },
  ],
  edges: [
    { id: 'e1', source: 'input-1', target: 'op-start' },
    { id: 'e2', source: 'op-start', target: 'cond-branch' },
    { id: 'e3', source: 'op-long1', target: 'op-long2' },
    { id: 'e4', source: 'op-long2', target: 'cond-merge' },
    { id: 'e5', source: 'op-inc', target: 'op-start' },
  ],
};

// Track execution per iteration
const iterNodes = new Map();

try {
  const result = await runGraph(graph, {
    onNodeComplete: (output) => {
      const iter = output.metadata?.iteration;
      if (iter !== undefined && iter !== null) {
        if (!iterNodes.has(iter)) iterNodes.set(iter, []);
        iterNodes.get(iter).push(output.nodeName);
      }
    },
  });

  console.log('=== Test Results ===\n');
  console.log(`Graph status: ${result.status}`);
  console.log(`Total node results: ${result.nodeResults.length}`);

  let allPassed = true;

  // Check each iteration
  for (const [iter, names] of [...iterNodes.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`\nIteration ${iter}: ${names.join(' -> ')}`);

    const hasMerge = names.includes('MergePoint');
    const hasLong2 = names.includes('LongPath2');
    const hasInc = names.includes('Increment');

    if (hasLong2 && !hasMerge) {
      console.log('  FAIL: LongPath2 executed but MergePoint was skipped!');
      allPassed = false;
    }
    if (hasMerge && hasLong2) {
      const mergeIdx = names.lastIndexOf('MergePoint');
      const long2Idx = names.indexOf('LongPath2');
      if (mergeIdx > long2Idx) {
        console.log('  PASS: MergePoint correctly evaluated AFTER LongPath2');
      }
    }
    if (hasInc) {
      console.log('  PASS: Increment executed (page will advance)');
    }
  }

  // Verify we didn't hit maxIterations (page should reach 3 in 2 loop iterations)
  if (result.status === 'completed') {
    console.log('\nPASS: Graph completed successfully (did not stall)');
  } else {
    console.log(`\nFAIL: Graph finished with status: ${result.status}`);
    allPassed = false;
  }

  // Verify page advanced correctly
  const lastIncrement = result.nodeResults
    .filter(r => r.nodeName === 'Increment')
    .pop();
  if (lastIncrement && lastIncrement.output?.page >= 3) {
    console.log('PASS: vars.page reached 3+ (pagination worked)');
  } else {
    console.log('FAIL: vars.page did not reach 3');
    allPassed = false;
  }

  console.log(`\n${allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allPassed ? 0 : 1);

} catch (err) {
  console.error('Test error:', err);
  process.exit(1);
}
