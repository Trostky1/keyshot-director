(() => {
  const byId = id => document.getElementById(id);
  let image = null, currentId = null, lastPhase = '', pending = false;
  const phase = { idle: 'Ready for a reference', inspecting: 'Inspecting your scene', planning: 'Reading the reference', lighting: 'Building the light', refining: 'Checking the real render', restoring: 'Restoring your scene', complete: 'Look applied', failed: 'Match needs attention', canceled: 'Match canceled', restored: 'Previous look restored' };
  const message = t => { byId('photoProgress').textContent = t; };
  async function request(url, data) {
    const r = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed.'); return j;
  }
  async function choose(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPG or WebP photo.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Use a reference photo under 25 MB.');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode(); const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      image = canvas.toDataURL('image/png'); byId('photoRef').src = image; byId('photoRef').hidden = false; byId('photoDropText').textContent = 'Change reference';
      byId('photoMatch').disabled = pending; message('Reference ready. Your current product angle is retained unless you choose “Match framing too”.');
    } finally { URL.revokeObjectURL(url); }
  }
  const drop = byId('photoDrop'); drop.onclick = () => byId('photoFile').click();
  byId('photoFile').onchange = e => choose(e.target.files[0]).catch(e => message(e.message));
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('dragover'); };
  drop.ondragleave = () => drop.classList.remove('dragover');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('dragover'); choose(e.dataTransfer.files[0]).catch(e => message(e.message)); };
  drop.addEventListener('referencepaste', e => choose(e.detail).catch(err => message(err.message)));
  byId('photoMatch').onclick = async () => {
    pending = true; byId('photoMatch').disabled = true;
    try { await request('/api/photo', { image, brief: byId('photoBrief').value, framing: byId('photoFraming').checked, quality: byId('photoQuality').value }); await poll(); }
    catch (e) { pending = false; byId('photoMatch').disabled = !image; message(e.message); }
  };
  byId('photoStop').onclick = () => request('/api/photo/stop', {}).then(r => message(r.note)).catch(e => message(e.message));
  byId('photoUndo').onclick = async () => { byId('photoUndo').disabled = true;
    try { await request('/api/photo/undo', {}); byId('photoComparison').hidden = true; await syncPose(); await loadStudio(); await poll(); }
    catch (e) { message(e.message); } };
  async function poll() {
    try {
      const s = await request('/api/photo'); pending = s.running;
      byId('photoMatch').disabled = pending || !image; byId('photoStop').disabled = !pending; byId('photoUndo').disabled = pending || !s.canUndo;
      byId('photoDrop').disabled = pending; byId('photoPhase').textContent = phase[s.phase] || s.phase;
      if (lastPhase !== s.phase) { lastPhase = s.phase; message(s.error || s.log?.at(-1) || '');
        if (['restored','canceled','failed'].includes(s.phase)) { byId('photoComparison').hidden = true; await syncPose(); await loadStudio(); }
      }
      if (s.result && currentId !== s.result.id && s.phase === 'complete') {
        currentId = s.result.id; const url = slot => `/api/photo/file?id=${encodeURIComponent(currentId)}&slot=${slot}`;
        byId('photoBefore').src = url('before'); byId('photoAfter').src = url('after'); byId('photoComparison').hidden = false;
        byId('photoDownload').href = url('after') + '&download'; byId('photoRecipe').href = url('recipe') + '&download';
        byId('photoEvidence').hidden = false; const box = byId('photoDecisions'); box.replaceChildren();
        for (const text of [s.result.title, ...(s.result.observations || []), ...(s.result.limitations || [])]) { const p = document.createElement('p'); p.textContent = text; box.appendChild(p); }
        byId('stage').style.aspectRatio = String(s.result.aspect); await syncPose(); await loadStudio();
      }
    } catch (e) { if (pending) message('Connection interrupted. Reconnecting to the photo job…'); }
  }
  document.querySelectorAll('[data-frame]').forEach(button => { button.onclick = async () => {
    const kind = button.dataset.frame, aspect = Number(byId('frameAspect').value); button.disabled = true;
    try { await request('/api/frame', { kind: kind === 'hero' ? 'hero' : 'detail', fill: kind === 'hero' ? 0.75 : 1.5, focus: kind === 'upper' ? [0,0.3,0] : [0,0,0], fov: 35, aspect });
      byId('stage').style.aspectRatio = String(aspect); await syncPose(); message('Framing updated. Materials and viewing angle were preserved.'); }
    catch (e) { message(e.message); } finally { button.disabled = false; }
  }; });
  byId('environmentFold').ontoggle = async e => { if (!e.target.open) return;
    try { const env = await request('/api/environment'); byId('envColor').value = '#' + env.bg.map(v => Math.round(255 * Math.pow(v / 255, 1 / 2.2)).toString(16).padStart(2,'0')).join('');
      if (typeof env.ground_shadows === 'boolean') byId('envShadows').checked = env.ground_shadows;
      if (typeof env.ground_reflections === 'boolean') byId('envReflections').checked = env.ground_reflections;
    } catch (e) { message(e.message); } };
  byId('environmentApply').onclick = async () => {
    const rgb = byId('envColor').value.match(/[a-f0-9]{2}/gi).map(x => parseInt(x,16));
    try { await request('/api/environment', { background: rgb, ground_shadows: byId('envShadows').checked, ground_reflections: byId('envReflections').checked }); await loadStudio(); message('Background and ground updated.'); }
    catch (e) { message(e.message); }
  };
  setInterval(poll, 1800); poll();
})();
