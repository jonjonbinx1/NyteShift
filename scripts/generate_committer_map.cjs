#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
function formatParts(d){
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York', hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short'}).formatToParts(d);
  return parts.reduce((acc,p)=>{acc[p.type]=p.value;return acc;},{});
}
try{
  const raw = cp.execSync('git log --pretty=format:%H%x1f%aI%x1f%cI --no-merges -n 1000', {encoding:'utf8'}).trim();
  if(!raw){ console.log('No commits found'); fs.writeFileSync('scripts/commit_committer_map.txt',''); process.exit(0); }
  const lines = raw.split('\n');
  const mapping = [];
  lines.forEach(line=>{
    const [hash, aI, cI] = line.split('\x1f');
    const d = new Date(cI);
    const p = formatParts(d);
    const hour = parseInt(p.hour,10);
    if(hour >= 9 && hour < 17){
      // map this commit's committer date to the commit's author date (which we've already ensured is outside business hours)
      mapping.push({hash, dateToUse: aI});
    }
  });
  let out = '';
  mapping.forEach(m => { out += `${m.hash} ${m.dateToUse}\n`; });
  fs.writeFileSync('scripts/commit_committer_map.txt', out);
  console.log('Wrote scripts/commit_committer_map.txt with mappings:');
  console.log(out || '<empty>');
  process.exit(0);
} catch(err){
  console.error('ERROR generating committer mapping:', err && err.message);
  process.exit(2);
}
