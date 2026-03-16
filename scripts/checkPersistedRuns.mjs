#!/usr/bin/env node
(async function(){
  try {
    const core = await import('../packages/core/dist/index.js');
    const runs = await core.listPersistedGraphRuns();
    console.log('PERSISTED_GRAPH_RUNS_COUNT=' + runs.length);
    if (runs.length > 0) {
      console.log('SAMPLE:', JSON.stringify(runs.slice(0,3).map(r=>({runId:r.runId, startedAt:r.startedAt, status:r.status})), null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err);
    process.exit(2);
  }
})();
