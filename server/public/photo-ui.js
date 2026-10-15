(() => {
  const byId = id => document.getElementById(id);
  let image = null, currentId = null, lastPhase = '', pending = false, launching = false;
  const phase = { idle: 'Ready for a reference', inspecting: 'Checking the KeyShot scene', planning: 'Reading the reference', lighting: 'Building the lighting setup', refining: 'Checking a KeyShot render', restoring: 'Restoring the scene', complete: 'Lighting match applied', failed: 'Lighting match needs attention', canceled: 'Lighting match stopped', restored: 'Previous lighting restored' };
  const message = t => { byId('photoProgress').textContent = t; };
  async function request(url, data) {
    let r;
    try { r = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
    catch { throw new Error('Could not reach Director. Check that the app is open, then try again.'); }
    let j;
    try { j = await r.json(); } catch { throw new Error('Director returned an unreadable response. Restart the app and try again.'); }
    if (!r.ok) throw new Error(j.error || `Director could not complete the lighting match (${r.status}).`);
    return j;
  }
  async function choose(file) {
    if (pending) throw new Error('Wait for the current lighting match to finish before changing its reference.');
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a reference image smaller than 25 MB.');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode(); const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      image = canvas.toDataURL('image/png'); byId('photoRef').src = image; byId('photoRef').alt = file.name ? `Reference image: ${file.name}` : 'Selected reference image'; byId('photoRef').hidden = false; byId('photoDropText').textContent = 'Change reference image';
      byId('photoMeasureRegion').checked = false;
      byId('referenceSelection').textContent = file.name || 'Reference image selected'; byId('clearPhoto').hidden = false; byId('referenceUseLabel').hidden = false;
      byId('directorResult').hidden = false;
      updateMode(); message('Reference ready. The current camera framing stays unless you choose to match the reference framing.');
    } finally { URL.revokeObjectURL(url); }
  }
  const drop = byId('photoDrop'); drop.onclick = () => byId('photoFile').click();
  byId('photoFile').onchange = e => choose(e.target.files[0]).catch(e => message(e.message));
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('dragover'); };
  drop.ondragleave = () => drop.classList.remove('dragover');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('dragover'); choose(e.dataTransfer.files[0]).catch(e => message(e.message)); };
  byId('studioWorkspace').addEventListener('paste', e => {
    if (e.target.closest('.promptbar, #styleLibraryFold, input, textarea')) return;
    const file = [...e.clipboardData.files].find(file => /^image\/(png|jpeg|webp)$/.test(file.type));
    if (file) { e.preventDefault(); choose(file).catch(error => message(error.message)); }
  });
  function updateMode() {
    const matching = !!image && byId('referenceUse').value === 'match';
    byId('directorMatchOptions').hidden = !matching;
    byId('directorPrivacy').hidden = !image;
    byId('directorPrivacy').textContent = matching
      ? 'For a lighting match, Director sends this reference image and KeyShot previews to your selected AI provider. Materials are not changed. Save the scene in KeyShot to keep the result.'
      : 'Director sends this reference image with your request to the selected AI provider.';
  }
  byId('referenceUse').onchange = updateMode;
  byId('clearPhoto').onclick = () => {
    if (pending) return;
    image = null; byId('photoRef').removeAttribute('src'); byId('photoRef').hidden = true;
    byId('photoRef').alt = '';
    byId('photoDropText').innerHTML = 'Add a reference image<span>Choose or drop · PNG, JPG, or WebP</span>';
    byId('referenceSelection').textContent = 'No reference image selected.';
    byId('clearPhoto').hidden = true; byId('referenceUseLabel').hidden = true; byId('photoFile').value = '';
    updateMode(); if (byId('photoUndo').disabled && byId('photoComparison').hidden) byId('directorResult').hidden = true;
  };
  const stop = () => request('/api/photo/stop', {}).then(r => message(r.note)).catch(e => message(e.message));
  byId('photoStop').onclick = stop;
  async function start({ brief = '', framing = false, quality = 'refined' } = {}) {
    if (!image) throw new Error('Add a reference image before starting a lighting match.');
    const measure = byId('photoMeasureRegion').checked;
    const region = Object.fromEntries(['X0', 'Y0', 'X1', 'Y1'].map(key => [key.toLowerCase(), Number(byId('photoRegion' + key).value) / 100]));
    if (measure && (!Object.values(region).every(n => Number.isFinite(n) && n >= 0 && n <= 1) || region.x1 - region.x0 < 0.025 || region.y1 - region.y0 < 0.025))
      throw new Error('Keep the rectangle within 0–100% on each edge and make it at least 2.5% wide and high.');
    const refinement = { objective: byId('photoObjective').value, max_attempts: Number(byId('photoAttempts').value),
      reference_region: measure ? region : null, locks: Object.fromEntries([...byId('photoLocks').querySelectorAll('input')].map(el => [el.value, el.checked])) };
    pending = true; launching = true; byId('photoDrop').disabled = true; byId('clearPhoto').disabled = true;
    for (const el of byId('photoRefinementOptions').querySelectorAll('input,select')) el.disabled = true;
    try {
      await request('/api/photo', { image, brief, framing, quality, refinement });
      launching = false;
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const status = await poll();
        if (status && !status.running) {
          if (status.phase === 'failed') throw new Error(status.error || 'The lighting match needs attention.');
          return status;
        }
      }
    } finally { launching = false; pending = false; byId('clearPhoto').disabled = false;
      for (const el of byId('photoRefinementOptions').querySelectorAll('input,select')) el.disabled = false; await poll(); }
  }
  byId('photoUndo').onclick = async () => { byId('photoUndo').disabled = true;
    try { await request('/api/photo/undo', {}); byId('photoComparison').hidden = true; await syncPose(); await loadStudio(); await poll(); }
    catch (e) { message(e.message); } };
  async function poll() {
    try {
      const s = await request('/api/photo'); pending = launching || s.running;
      byId('photoStop').disabled = !pending; byId('photoUndo').disabled = pending || !s.canUndo;
      byId('photoDrop').disabled = pending; byId('photoPhase').textContent = s.phase === 'measuring' ? 'Measuring the render' : phase[s.phase] || s.phase;
      byId('directorResult').hidden = !image && !s.running && !s.canUndo && !s.result;
      if (lastPhase !== s.phase) { lastPhase = s.phase; message(s.error || s.log?.at(-1) || '');
        if (['restored','canceled','failed'].includes(s.phase)) { byId('photoComparison').hidden = true; await syncPose(); await loadStudio(); }
      }
      if (s.result && currentId !== s.result.id && s.phase === 'complete') {
        currentId = s.result.id; const url = slot => `/api/photo/file?id=${encodeURIComponent(currentId)}&slot=${slot}`;
        byId('photoBefore').src = url('before'); byId('photoAfter').src = url('after'); byId('photoComparison').hidden = false;
        byId('photoDownload').href = url('after') + '&download'; byId('photoRecipe').href = url('recipe') + '&download';
        byId('photoEvidence').hidden = false; const box = byId('photoDecisions'); box.replaceChildren();
        for (const text of [s.result.title, ...(s.result.observations || []), ...(s.result.limitations || [])]) { const p = document.createElement('p'); p.textContent = text; box.appendChild(p); }
        if (s.result.refinement) { const p = document.createElement('p'); p.textContent = `${s.result.refinement.accepted_attempts} improved candidates kept; ${s.result.refinement.captures_used} captures used.`; box.appendChild(p); }
        byId('stage').style.aspectRatio = String(s.result.aspect); await syncPose(); await loadStudio();
      }
      return s;
    } catch (e) { if (pending) message('Connection interrupted. Reconnecting to the photo job…'); return null; }
  }
  document.querySelectorAll('[data-frame]').forEach(button => { button.onclick = async () => {
    const kind = button.dataset.frame, aspect = Number(byId('frameAspect').value); button.disabled = true;
    try {
      let useSelectedPart = false;
      if (kind === 'detail') {
        const context = await request('/api/scene-context');
        const selection = context.target?.selection || [];
        if (selection.length > 1) throw new Error('Select one part in KeyShot for a close-up, or clear the selection to frame the full product.');
        useSelectedPart = selection.length === 1;
      }
      const result = await request('/api/frame', { kind: kind === 'hero' ? 'hero' : 'detail', fill: kind === 'hero' ? 0.75 : 1.5, focus: kind === 'upper' ? [0,0.3,0] : [0,0,0], fov: 35, aspect, ...(useSelectedPart ? { use_selected_part: true } : {}) });
      byId('stage').style.aspectRatio = String(aspect); await syncPose(); message(useSelectedPart ? `Framed ${result.target_part || 'the selected part'}. Material assignments were not changed.` : 'Framing updated. Material assignments were not changed.'); }
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
  window.directorPhoto = { get image() { return image; }, get running() { return pending; }, start, stop };
  setInterval(poll, 1800); poll();
})();
