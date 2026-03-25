#!/usr/bin/env node
const cp = require('child_process');
try{
  const branch = cp.execSync('git rev-parse --abbrev-ref HEAD', {encoding:'utf8'}).trim();
  console.log('BRANCH:' + branch);
  const raw = cp.execSync('git log --pretty=format:%H%x1f%aI%x1f%an%x1f%s --no-merges -n 500', {encoding:'utf8'});
  if (!raw.trim()) { console.log('TOTAL_COMMIT_COUNT:0'); console.log('OFFENDING_COMMIT_COUNT:0'); process.exit(0); }
  const lines = raw.split('\n');
  const tz = 'America/New_York';
  function formatParts(d){
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:tz, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}).formatToParts(d);
    return parts.reduce((acc,p)=>{acc[p.type]=p.value;return acc;},{})
  }
  let total = 0; let off = 0; const offending=[];
  lines.forEach(line=>{
    const [hash, iso, author, subject] = line.split('\x1f');
    const date = new Date(iso);
    const p = formatParts(date);
    const hour = parseInt(p.hour,10);
    const isoLocal = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    const isOff = hour >= 9 && hour < 17; // 09:00-16:59 considered forbidden; adjust if needed
    total++;
    if(isOff){ off++; offending.push({hash,iso,isoLocal,hour,author,subject}); }
  });
  console.log(`TOTAL_COMMIT_COUNT:${total}`);
  console.log(`OFFENDING_COMMIT_COUNT:${off}`);
  if(off>0){
    console.log('OFFENDING_COMMIT_HASHES:');
    offending.forEach(c=>{
      console.log(`${c.hash} | ${c.iso} -> ${c.isoLocal} (NYC) | hour:${c.hour} | ${c.author} | ${c.subject}`);
    });
  } else {
    console.log('NO_OFFENDING_COMMITS');
  }
} catch (err){
  console.error('ERROR:', err.message);
  process.exit(2);
}
