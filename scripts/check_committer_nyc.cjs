#!/usr/bin/env node
const cp = require('child_process');
try{
  const raw = cp.execSync('git log --pretty=format:%H%x1f%cI%x1f%cn%x1f%s --no-merges -n 1000', {encoding:'utf8'}).trim();
  if(!raw){ console.log('TOTAL_COMMIT_COUNT:0'); process.exit(0); }
  const lines = raw.split('\n');
  const tz = 'America/New_York';
  function formatParts(d){
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:tz, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}).formatToParts(d);
    return parts.reduce((acc,p)=>{acc[p.type]=p.value;return acc;},{});
  }
  let total=0, off=0; const offending=[];
  lines.forEach(line=>{
    const [hash, cI, committer, subject] = line.split('\x1f');
    const d = new Date(cI);
    const p = formatParts(d);
    const hour = parseInt(p.hour,10);
    total++;
    if(hour >= 9 && hour < 17){ off++; offending.push({hash,cI,local:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`,hour,committer,subject}); }
  });
  console.log('TOTAL_COMMIT_COUNT:'+total);
  console.log('OFFENDING_COMMIT_COUNT:'+off);
  if(off>0){
    console.log('OFFENDING_COMMITS:');
    offending.forEach(c=> console.log(`${c.hash} | ${c.cI} -> ${c.local} (NYC) | hour:${c.hour} | ${c.committer} | ${c.subject}`));
  } else { console.log('NO_OFFENDING_COMMITS'); }
  process.exit(0);
} catch(err){ console.error('ERROR:', err && err.message); process.exit(2); }
