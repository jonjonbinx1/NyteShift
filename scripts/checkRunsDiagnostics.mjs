#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
(async ()=>{
  try{
    const utils = await import('../packages/core/dist/utils/index.js');
    const runStore = await import('../packages/core/dist/runtime/runs/runStore.js');
    const { nyteShiftHome, runsDir } = utils;
    const home = nyteShiftHome();
    const rdir = runsDir();
    const graphsDir = path.join(rdir, 'graphs');
    console.log('nyteShiftHome ->', home);
    console.log('runsDir ->', rdir);
    console.log('graphsDir ->', graphsDir);
    try{
      const entries = await readdir(graphsDir);
      console.log('readdir success, entries count=', entries.length);
      console.log('sample entries=', entries.slice(0,10));
    } catch (err) {
      console.error('readdir failed:', err && err.code, err && err.message);
    }
    try{
      const runs = await runStore.listPersistedGraphRuns();
      console.log('listPersistedGraphRuns ->', runs.length);
    } catch (err) {
      console.error('listPersistedGraphRuns ERROR ->', err);
    }
    process.exit(0);
  }catch(e){
    console.error('load error', e);
    process.exit(2);
  }
})();
