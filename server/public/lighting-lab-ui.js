(() => {
  const $ = id => document.getElementById(id);
  const type = $('lightingLabType'), inspect = $('lightingLabInspect'), replay = $('lightingLabReplay');
  const snapshot = $('lightingLabSnapshot');
  const surface = $('lightingLabSurface');
  const capture = $('lightingLabCapture'), replayCapture = $('lightingLabReplayCapture'), status = $('lightingLabStatus'), output = $('lightingLabOutput');
  const images = $('lightingLabImages');
  let lastInspectionRunId = null;
  let lastCaptureRunId = null;

  async function post(url, payload) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }

  function showInspection(record, replayed) {
    lastInspectionRunId = record.id || null;
    replay.disabled = !lastInspectionRunId;
    images.replaceChildren();
    const keyshot = record.keyshot || record.output?.keyshot || {};
    const group = record.output?.lights?.[type.value];
    const count = group?.assets?.length ?? 0;
    const names = (group?.assets || []).map(asset => asset.material);
    const params = [...new Set((group?.assets || []).flatMap(asset => asset.parameters.map(parameter => parameter.name)))];
    status.textContent = record.status === 'failed'
      ? `Could not inspect the ${type.value} light graph: ${record.error || 'KeyShot returned an unknown error.'} · run ${record.id}`
      : `${replayed ? 'Repeat inspection' : 'Inspection'} complete · KeyShot ${keyshot.display_version || keyshot.version || 'version unavailable'} · ${count} ${type.value} light graph${count === 1 ? '' : 's'} found · run ${record.id}`;
    const details = group ? { selected_type: type.value, shader_type: group.shader_type, candidate_count: group.candidate_count,
      truncated: group.truncated, candidate_names: group.candidate_names, materials: names, unmatched_assets: group.unmatched_assets,
      exposed_parameters: params, parameter_graphs: group.assets, material_templates: record.output?.material_templates,
      keyshot_api_surface: record.output?.api_surface,
      graph_class_surfaces: record.output?.api_surface?.type_surfaces,
      validation: record.validation, result_hash: record.result_hash, replay_of: record.replay_of || null }
      : { validation: record.validation, error: record.error, replay_of: record.replay_of || null };
    output.textContent = JSON.stringify(details, null, 2);
  }

  function showCapture(record) {
    lastCaptureRunId = record.id || null;
    replayCapture.disabled = !lastCaptureRunId;
    images.replaceChildren();
    const result = record.output;
    const checks = record.validation || [];
    let comparisonText = '';
    const comparison = result?.analysis?.comparison_to?.result;
    if (comparison?.available) {
      const direct = comparison.passes?.direct?.product;
      const reflection = comparison.passes?.reflection?.product;
      const fmt = value => `${value >= 0 ? '+' : ''}${value.toFixed(6)}`;
      const parts = [comparison.mask_agreement?.suitable_for_lighting_only_comparison ? 'product framing stayed consistent' : 'product framing shifted'];
      if (direct && Number.isFinite(direct.mean_signed_luma_delta)) parts.push(`Direct light change ${fmt(direct.mean_signed_luma_delta)} · average absolute change ${direct.mean_absolute_luma_delta.toFixed(6)}`);
      if (reflection && Number.isFinite(reflection.mean_signed_luma_delta)) parts.push(`Reflection change ${fmt(reflection.mean_signed_luma_delta)} · average absolute change ${reflection.mean_absolute_luma_delta.toFixed(6)}`);
      comparisonText = ` · ${parts.join(' · ')}`;
    }
    status.textContent = record.status === 'failed'
      ? `Could not capture the render passes: ${record.error || 'KeyShot returned an unknown error.'} · run ${record.id}`
      : `${record.replay_of ? 'Comparison capture' : 'Render capture'} complete · ${result?.elapsed_seconds ?? '?'} sec · scene ${result?.scene_unchanged ? 'unchanged' : 'changed; check it'} · render settings ${result?.render_options_unchanged ? 'unchanged' : 'changed; check them'}${comparisonText} · run ${record.id}`;
    output.textContent = JSON.stringify({ requested_passes: result?.requested_passes, missing_passes: result?.missing_passes,
      size: result ? `${result.width} × ${result.height}` : null, files: (result?.files || []).map(file => ({ pass: file.pass, name: file.name, bytes: file.bytes, sha256: file.sha256, extension: file.extension })),
      region_analysis: result?.analysis,
      validation: checks, result_hash: record.result_hash }, null, 2);
    for (const file of result?.files || []) {
      const target = `/api/lighting-lab/file?run_id=${encodeURIComponent(record.id)}&name=${encodeURIComponent(file.name)}`;
      const item = document.createElement('div');
      item.style.cssText = 'max-width:160px;font-size:10px;color:var(--dim)';
      if (['.png', '.jpg', '.jpeg'].includes(file.extension)) {
        const img = document.createElement('img');
        img.src = target; img.alt = `${file.pass} render pass`; img.loading = 'lazy';
        img.style.cssText = 'display:block;max-width:160px;max-height:120px;object-fit:contain;border:1px solid var(--line);margin-bottom:4px';
        item.appendChild(img);
      } else {
        const link = document.createElement('a'); link.href = target; link.textContent = 'Download EXR';
        item.appendChild(link);
      }
      const caption = document.createElement('div'); caption.textContent = `${file.pass}: ${file.name}`; item.appendChild(caption);
      images.appendChild(item);
    }
  }

  function showSceneSnapshot(record) {
    images.replaceChildren();
    const result = record.output || {};
    const scene = result.scene || {};
    const unitReady = scene.unit === 'mm' && Math.abs(Number(scene.unitScale) - 1000) < 0.000001;
    status.textContent = record.status === 'failed'
      ? `Could not capture the scene settings: ${record.error || 'KeyShot returned an unknown error.'} · run ${record.id}`
      : `Scene settings captured · units: ${scene.unit || 'unknown'} · ${result.geometry_ids?.length ?? '?'} part IDs · ${result.tree?.length ?? '?'} scene items · Area Light import ${unitReady ? 'ready (millimeter units)' : 'unavailable until the scene uses millimeters'}${result.scene_changed ? ' · unsaved scene edits detected' : ''} · run ${record.id}`;
    output.textContent = JSON.stringify({ keyshot: result.keyshot, scene, scene_materials: result.scene_materials,
      geometry_ids: result.geometry_ids, tree: result.tree, camera: result.camera, environment: result.environment,
      render_options_hash: result.render_options_hash, scene_changed: result.scene_changed,
      area_light_import_ready: unitReady,
      scene_signature: result.scene_signature, validation: record.validation, replay_of: record.replay_of || null }, null, 2);
  }

  async function runSceneSnapshot() {
    snapshot.disabled = inspect.disabled = replay.disabled = capture.disabled = replayCapture.disabled = true;
    status.textContent = 'Reading part names and scene settings…';
    try {
      const record = await post('/api/lighting-lab/run', { operation_id: 'lighting.inspect_scene_state', inputs: {} });
      showSceneSnapshot(record);
    } catch (error) {
      status.textContent = error.message;
      output.textContent = '';
      images.replaceChildren();
    } finally {
      snapshot.disabled = inspect.disabled = capture.disabled = false;
      replayCapture.disabled = !lastCaptureRunId;
      replay.disabled = !lastInspectionRunId;
    }
  }

  async function runControlSurface() {
    snapshot.disabled = surface.disabled = inspect.disabled = replay.disabled = capture.disabled = replayCapture.disabled = true;
    status.textContent = 'Checking which lighting controls KeyShot exposes…';
    try {
      const record = await post('/api/lighting-lab/run', { operation_id: 'lighting.inspect_control_surface', inputs: {} });
      const result = record.output || {};
      const api = result.api_surface || {};
      status.textContent = record.status === 'failed'
        ? `Could not inspect KeyShot lighting controls: ${record.error || 'KeyShot returned an unknown error.'} · run ${record.id}`
        : `Lighting control inspection complete · KeyShot ${result.keyshot?.display_version || result.keyshot?.version || 'version unavailable'} · ${api.lighting_related_lux_names?.length ?? 0} lighting-related controls found · run ${record.id}`;
      output.textContent = JSON.stringify({ keyshot: result.keyshot, inspection_scope: result.inspection_scope,
        lighting_related_lux_names: api.lighting_related_lux_names, potential_pin_names: api.potential_pin_names,
        surface_targeting_names: api.surface_targeting_names,
        constants: api.constants, function_docs: api.function_docs, type_surfaces: api.type_surfaces,
        validation: record.validation, result_hash: record.result_hash }, null, 2);
      images.replaceChildren();
    } catch (error) {
      status.textContent = error.message;
      output.textContent = '';
      images.replaceChildren();
    } finally {
      snapshot.disabled = surface.disabled = inspect.disabled = capture.disabled = false;
      replayCapture.disabled = !lastCaptureRunId;
      replay.disabled = !lastInspectionRunId;
    }
  }

  async function runInspection(replayLast) {
    snapshot.disabled = inspect.disabled = replay.disabled = capture.disabled = replayCapture.disabled = true;
    status.textContent = replayLast ? 'Repeating the inspection with this light type…' : 'Reading KeyShot light material graphs…';
    try {
      const inputs = { types: [type.value], max_assets: 12 };
      const record = replayLast
        ? await post('/api/lighting-lab/replay', { run_id: lastInspectionRunId, inputs })
        : await post('/api/lighting-lab/run', { operation_id: 'lighting.inspect_light_graphs', inputs });
      showInspection(record, replayLast);
    } catch (error) {
      status.textContent = error.message;
      output.textContent = '';
    } finally {
      snapshot.disabled = inspect.disabled = capture.disabled = false;
      replayCapture.disabled = !lastCaptureRunId;
      replay.disabled = !lastInspectionRunId;
    }
  }

  async function runCapture(compareLast = false) {
    const passes = [...$('lightingLabPasses').querySelectorAll('input:checked')].map(input => input.value);
    if (!passes.length) { status.textContent = 'Select at least one diagnostic pass.'; return; }
    if (compareLast && !lastCaptureRunId) return;
    snapshot.disabled = inspect.disabled = replay.disabled = capture.disabled = replayCapture.disabled = true;
    status.textContent = compareLast ? 'Capturing the same render passes again for comparison…' : 'Rendering a small diagnostic preview with copied settings…';
    try {
      const record = compareLast
        ? await post('/api/lighting-lab/replay', { run_id: lastCaptureRunId })
        : await post('/api/lighting-lab/run', { operation_id: 'lighting.capture_diagnostic_passes', inputs: { passes, width: 640, height: 400, secs: 2 } });
      showCapture(record);
    } catch (error) {
      status.textContent = error.message;
      output.textContent = '';
      images.replaceChildren();
    } finally {
      snapshot.disabled = inspect.disabled = capture.disabled = false;
      replay.disabled = !lastInspectionRunId;
      replayCapture.disabled = !lastCaptureRunId;
    }
  }

  snapshot.addEventListener('click', runSceneSnapshot);
  surface.addEventListener('click', runControlSurface);
  inspect.addEventListener('click', () => runInspection(false));
  replay.addEventListener('click', () => runInspection(true));
  capture.addEventListener('click', runCapture);
  replayCapture.addEventListener('click', () => runCapture(true));
})();
