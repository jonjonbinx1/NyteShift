#!/usr/bin/env node
const cp = require('child_process');
try{
  const raw = cp.execSync('git log --pretty=format:%H%x1f%aI%x1f%cI%x1f%an%x1f%s --no-merges -n 500', {encoding:'utf8'}).trim();
  if(!raw){ console.log('No commits found'); process.exit(0); }
  const lines = raw.split('\n');
  const tz = 'America/New_York';
  function fmtIsoToNY(iso){
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:tz, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short'}).formatToParts(d).reduce((acc,p)=>{acc[p.type]=p.value;return acc;},{});
    const tzName = parts.timeZoneName || '';
    const offset = tzName.indexOf('DT') !== -1 ? '-04:00' : '-05:00';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  }
  lines.forEach(line=>{
    const [hash, aI, cI, author, subject] = line.split('\x1f');
    let aNY, cNY;
    try{ aNY = fmtIsoToNY(aI); } catch(e){ aNY = aI; }
    try{ cNY = fmtIsoToNY(cI); } catch(e){ cNY = cI; }
    console.log(`${hash} | author:${aI} -> ${aNY} | committer:${cI} -> ${cNY} | ${author} | ${subject}`);
  });
} catch(err){
  console.error('ERROR:', err && err.message);
  process.exit(2);
}
