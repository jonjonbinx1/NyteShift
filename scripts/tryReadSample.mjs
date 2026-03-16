#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
(async ()=>{
  try{
    const graphsDir = path.join((await import('../packages/core/dist/utils/index.js')).runsDir(), 'graphs');
    const entries = await readdir(graphsDir);
    const sample = entries.filter(e=>e.endsWith('.json')).slice(0,10);
    for (const f of sample) {
      try{
        const raw = await readFile(path.join(graphsDir, f), 'utf-8');
        JSON.parse(raw);
        console.log('OK', f, 'len=', raw.length);
      }catch(err){
        console.error('PARSEERR', f, err && err.message);
      }
    }
    process.exit(0);
  }catch(e){
    console.error('ERR', e);
    process.exit(2);
  }
})();
