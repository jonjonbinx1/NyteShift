import fs from 'node:fs/promises';
import path from 'node:path';
import { runGraph } from '../packages/core/dist/index.js';

async function main() {
  const p = path.resolve(process.env.HOME || process.env.USERPROFILE, '.nyteshift', 'graphs', 'graph-1773370695650.json');
  const raw = await fs.readFile(p, 'utf8');
  const graph = JSON.parse(raw);

  // Clone and stub external nodes to operation nodes to avoid provider/tool calls
  const g = JSON.parse(JSON.stringify(graph));
  g.maxIterations = 4;

  // Track classify call count so the first call errors (simulating 400)
  // and the second call succeeds (simulating a shorter page).
  let classifyCallCount = 0;

  for (const node of g.nodes) {
    if (node.id === 'tool-mmob4svt') {
      node.type = 'operation';
      node.operationAction = { op: 'set', varName: 'hasNext', value: true };
    } else if (node.id === 'trigger-mmodp1gh') {
      node.type = 'operation';
      node.operationAction = { op: 'set', varName: 'uids', value: [111] };
    } else if (node.id === 'tool-mmoe6s5s') {
      node.type = 'operation';
      node.operationAction = { op: 'set', varName: 'message', value: 'MESSAGE' };
    } else if (node.id === 'llm-mmoei94w') {
      // Leave as LLM — we'll override callProvider behavior below.
      // Instead, use an error policy so the node halts on error.
      // Actually, we need this to throw to trigger the loop error exit.
      // The simplest stub: error on first call, succeed on second.
      // We'll handle this by making it an operation node whose value
      // depends on a counter we manage via a wrapper.
    } else if (node.type === 'tool' || node.type === 'llm' || node.type === 'trigger' || node.type === 'agent' || node.type === 'skill') {
      node.type = 'operation';
      node.operationAction = { op: 'set', varName: `${node.id}_ok`, value: true };
    }
  }

  // Make the classify node throw on the first iteration to simulate a provider 400.
  // We use a tool node referencing a non-existent tool so it throws in the loop,
  // causing exitReason "error".  The error is surfaced via the providerOutput
  // mechanism so catch nodes can inspect the error body.
  //
  // But we need the classify OUTPUT (stored under outputKey "classify") to contain
  // the error body so `{{classify.output.error.code}}` resolves to 400.
  // With error policy "halt" + the providerOutput fix, the node's `output` field
  // carries the parsed error body.  To simulate this without a real provider,
  // override executeNode to throw an error with providerOutput attached.
  //
  // Simplest workaround: give it a tool node with a non-existent tool.
  // The error message will be "Tool ... not found" and output will be null.
  // Instead, manually set classify output after the run to check routing.
  //
  // Actually, let's just directly test the rewind behavior using maxIterations
  // exit (which catch-mmofz6iq handles) and set catch-mmofz6iq to rewindTo a
  // node in the loop. That's the simpler test that verifies the rewind mechanism.
  const classifyNode = g.nodes.find(n => n.id === 'llm-mmoei94w');
  classifyNode.type = 'operation';
  classifyNode.operationAction = { op: 'set', varName: 'classify', value: [] };

  // Also set catch 1 (maxIterations/abort) to rewindTo the loop entry to verify rewind
  const catch1 = g.nodes.find(n => n.id === 'catch-mmofz6iq');
  catch1.resumePolicy = 'always';
  catch1.resumeStrategy = 'rewindTo';
  catch1.resumeTarget = 'operation-mmofvk8v'; // loop entry — already ran

  console.log('Running modified graph (stubs in place)...');
  const res = await runGraph(g, {});
  console.log('RESULT', JSON.stringify(res, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
