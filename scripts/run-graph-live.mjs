import { writeFile } from 'node:fs/promises';
import { runGraph, whenUserProvidersLoaded } from '../packages/core/dist/index.js';

process.env.SOLIX_DEBUG_PROVIDER_RAW = '1';

const GRAPH_ID = 'graph-1773080377747';
const OP2_ID = 'operation-mmjo085a';
const HASNEXT_ID = 'condition-mmjoiy72';
const GETMSG_ID = 'tool-mmjia8by';

const seenByIter = new Map();
let lastOp2Iter = null;
let foundSkip = false;

const abortController = new AbortController();

function prettyOut(o) {
  try { return JSON.stringify(o); } catch { return String(o); }
}

console.log(`Running graph ${GRAPH_ID} with SOLIX_DEBUG_PROVIDER_RAW=${process.env.SOLIX_DEBUG_PROVIDER_RAW}`);
// Wait until any user-provided providers (e.g. local-inference) finish loading
console.log('Waiting for user providers to register (whenUserProvidersLoaded)...');
await whenUserProvidersLoaded();
console.log('User providers registration complete.');

try {
  const result = await runGraph(GRAPH_ID, {
    signal: abortController.signal,
    onNodeStart: (nodeId, nodeName) => {
      const ts = new Date().toISOString();
      console.log(`${ts} [nodeStart] ${nodeName} (${nodeId})`);
    },
    onNodeComplete: (nodeOutput) => {
      const iter = typeof nodeOutput.metadata?.iteration === 'number' ? nodeOutput.metadata.iteration : null;
      if (iter !== null) {
        let s = seenByIter.get(iter);
        if (!s) { s = new Set(); seenByIter.set(iter, s); }
        s.add(nodeOutput.nodeId);
      }
      const ts = new Date().toISOString();
      console.log(`${ts} [nodeComplete] ${nodeOutput.nodeName} (${nodeOutput.nodeId}) iter=${iter} status=${nodeOutput.status} output=${prettyOut(nodeOutput.output)}`);

      if (nodeOutput.nodeId === OP2_ID && nodeOutput.status === 'success') {
        lastOp2Iter = typeof nodeOutput.metadata?.iteration === 'number' ? nodeOutput.metadata.iteration : null;
        console.log(`  -> recorded Operation 2 at iter=${lastOp2Iter}`);
      }

      if ((nodeOutput.nodeId === GETMSG_ID || nodeOutput.nodeName === 'Get Message UID') && nodeOutput.status === 'success') {
        const currentIter = typeof nodeOutput.metadata?.iteration === 'number' ? nodeOutput.metadata.iteration : null;
        if (lastOp2Iter !== null && currentIter !== null && currentIter > lastOp2Iter) {
          const seen = seenByIter.get(lastOp2Iter);
          if (!seen || !seen.has(HASNEXT_ID)) {
            console.log(`Detected skip: Operation 2 at iter=${lastOp2Iter} but HasNext not seen in that iteration. Aborting run.`);
            foundSkip = true;
            abortController.abort();
          }
        }
      }
    },
  });

  console.log('Run finished:', result.status, 'nodeResults:', result.nodeResults?.length ?? 0);
  if (foundSkip) {
    await writeFile('graph-skip-trace.json', JSON.stringify(result, null, 2));
    console.log('Wrote graph-skip-trace.json');
  }
} catch (err) {
  console.error('Run error:', err);
  process.exit(1);
}
