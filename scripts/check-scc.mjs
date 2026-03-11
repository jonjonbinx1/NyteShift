import { readFileSync } from 'node:fs';
import { tarjanSCC } from '../packages/core/dist/runtime/graph/graphValidator.js';

const graph = JSON.parse(readFileSync('C:/Users/johnb/.nyteshift/graphs/graph-1773080377747.json','utf8'));

const adj = new Map();
for (const n of graph.nodes) adj.set(n.id, []);
for (const e of graph.edges) adj.get(e.source)?.push(e.target);
for (const n of graph.nodes) {
  if (n.type === 'condition' && n.branches) {
    const t = adj.get(n.id);
    for (const b of n.branches) { if (!t.includes(b.target)) t.push(b.target); }
    if (n.defaultTarget && !t.includes(n.defaultTarget)) t.push(n.defaultTarget);
  }
}

const sccs = tarjanSCC(adj);
const nameMap = {};
for (const n of graph.nodes) nameMap[n.id] = n.name;
console.log('SCCs (Tarjan):');
for (const scc of sccs) {
  const members = [...scc].map(id => id + ' (' + (nameMap[id] || '?') + ')');
  console.log('  SCC(' + scc.size + '): ' + members.join(', '));
}

// Compute BFS withinOrder for the big SCC
const bigSCC = sccs.find(s => s.size > 1);
if (bigSCC) {
  let entry;
  for (const id of bigSCC) {
    for (const [src, targets] of adj) {
      if (!bigSCC.has(src) && targets.includes(id)) { entry = id; break; }
    }
    if (entry) break;
  }
  console.log('\nSCC entry:', entry, '(' + nameMap[entry] + ')');
  const visited = new Set();
  const order = [];
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    if (!bigSCC.has(cur)) continue;
    visited.add(cur);
    order.push(cur);
    for (const next of adj.get(cur) || []) {
      if (bigSCC.has(next) && !visited.has(next)) queue.push(next);
    }
  }
  console.log('\nwithinOrder (BFS):');
  order.forEach((id, i) => console.log('  ' + i + ': ' + id + ' (' + nameMap[id] + ')'));
}
