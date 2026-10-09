// imp.js <glb path> [no-anim] [depth] - import a file through the bridge and print the new model's tree
const { send } = require('../server/bridge');
const path = require('path');
const file = path.resolve(process.argv[2]);
const noAnim = process.argv[3] === 'no-anim';
(async () => {
  const r = await send('anim_import', { path: file, depth: +process.argv[4] || 6, opts: noAnim ? { import_animation: false } : {} }, 300000);
  console.log('file', file, '| anim', JSON.stringify(r.animation_info));
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const f = n => (n.name === base ? [n] : (n.children || []).flatMap(f));
  const p = (n, d) => { console.log(' '.repeat(d * 2) + n.name + ' [' + n.kind + '] id' + n.id); (n.children || []).forEach(c => p(c, d + 1)); };
  f(r.tree).forEach(n => p(n, 0));
})().catch(e => console.log('ERR', String(e.message).split('\n').slice(-4).join(' | ')));
