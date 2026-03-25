#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
function pad(n){return n.toString().padStart(2,'0');}
function formatParts(d){
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York', hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short'}).formatToParts(d);
  return parts.reduce((acc,p)=>{acc[p.type]=p.value;return acc;},{});
}
try{
  const raw = cp.execSync('git log --pretty=format:%H%x1f%aI --no-merges -n 1000', {encoding:'utf8'}).trim();
  if(!raw){ console.log('No commits found'); process.exit(0); }
  const lines = raw.split('\n');
  const offending = [];
  for(const line of lines){
    const [hash, iso] = line.split('\x1f');
    const d = new Date(iso);
    const p = formatParts(d);
    const hour = parseInt(p.hour,10);
    if(hour >= 9 && hour < 17){
      offending.push({hash, iso, local: p});
    }
  }
  if(offending.length===0){
    console.log('No offending commits found');
    fs.writeFileSync('scripts/commit_date_map.txt','');
    process.exit(0);
  }
  const candidateHours = [19,20,21,22,18,23,0,1,2,3,4,5];
  const mapping = [];
  for(const obj of offending){
    try{
      const {hash, iso, local} = obj;
      const seed = parseInt(hash.slice(0,8),16) >>> 0;
      const hour = candidateHours[seed % candidateHours.length];
      const minute = Math.floor(seed / 256) % 60;
      const second = Math.floor(seed / 65536) % 60;
      const year = local.year, month = local.month, day = local.day;
      const baseLocal = `${year}-${month}-${day}`;
      const baseLocalTime = `${baseLocal}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
      // try offsets -04:00 and -05:00 to detect correct DST offset for this local time
      const offsets = ['-04:00','-05:00'];
      let chosenOffset = null;
      for(const off of offsets){
        const isoCandidate = baseLocalTime + off;
        const candDate = new Date(isoCandidate);
        try{
          const candParts = formatParts(candDate);
          if(candParts.year===year && candParts.month===month && candParts.day===day && parseInt(candParts.hour,10)===hour && parseInt(candParts.minute,10)===minute){
            chosenOffset = off; break;
          }
        } catch(errInner){
          console.error('Skipping offset check for', hash, 'isoCandidate', isoCandidate, 'error', errInner && errInner.message);
        }
      }
      if(!chosenOffset){
        // fallback: use original commit's observed timezone name
        const tzName = local.timeZoneName || '';
        chosenOffset = (tzName.indexOf('DT')!==-1) ? '-04:00' : '-05:00';
      }
      const finalIso = baseLocalTime + chosenOffset;
      mapping.push({hash, finalIso});
    } catch(errCommit){
      console.error('ERROR processing commit', obj && obj.hash, obj && obj.iso, errCommit && errCommit.stack);
    }
  }
  let out = '';
  for(const m of mapping){ out += `${m.hash} ${m.finalIso}\n`; }
  fs.writeFileSync('scripts/commit_date_map.txt', out);
  console.log('Wrote scripts/commit_date_map.txt with mappings:');
  console.log(out);
  process.exit(0);
} catch(err){
  console.error('ERROR generating mapping:', err && err.message);
  process.exit(2);
}
