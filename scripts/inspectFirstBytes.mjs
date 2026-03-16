#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runsDir } from '../packages/core/dist/utils/index.js';
const graphsDir = path.join(runsDir(), 'graphs');
const fname = '00103b49-578d-41e0-b273-30cb2015c2ff.json';
const p = path.join(graphsDir, fname);
try{
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(16);
  const read = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  console.log('firstBytesHex:', buf.slice(0, read).toString('hex'));
  console.log('firstChars:', buf.slice(0, read).toString('utf8'));
} catch (e) {
  console.error('ERR', e);
}
