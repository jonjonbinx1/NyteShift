#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runsDir } from '../packages/core/dist/utils/index.js';

(async () => {
  try {
    const graphsDir = path.join(runsDir(), 'graphs');
    const entries = await readdir(graphsDir);
    let scanned = 0;
    let fixed = 0;
    for (const e of entries) {
      if (!e.endsWith('.json')) continue;
      scanned++;
      const p = path.join(graphsDir, e);
      try {
        const buf = await readFile(p);
        if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
          await writeFile(p, buf.slice(3));
          fixed++;
        }
      } catch (err) {
        console.error('read/write error', e, err && err.message);
      }
    }
    console.log(`STRIPBOM_DONE scanned=${scanned} fixed=${fixed}`);
    process.exit(0);
  } catch (err) {
    console.error('STRIPBOM_ERROR', err && err.message);
    process.exit(2);
  }
})();
