// Persistent job/recovery receipts. One JSON file per job records what the job intended to change and what it owns, so a
// restart can show an unfinished job instead of silently overwriting or abandoning the scene. Ownership is ONLY what the
// job recorded; a node that merely looks like ours (name prefix) is reported as unowned and is never adopted.
// Offline module: it reads and writes receipt files and compares them with an inventory the caller supplies.
const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
const FILE = 'receipt.json';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_OPERATIONS = 400;
const JOB_STATUSES = ['running', 'complete', 'failed', 'canceled', 'dismissed', 'recovered'];
const RESTORE_STATUSES = ['not_needed', 'pending', 'available', 'complete', 'failed', 'dismissed'];
const OWNED_KINDS = ['light', 'environment', 'camera_checkpoint', 'material', 'node'];
const jobId = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid job id.'); return id; };
const clone = v => JSON.parse(JSON.stringify(v));

function createReceiptStore({ root, now = () => new Date().toISOString() }) {
  if (typeof root !== 'string' || !root) throw new Error('A receipt directory is required.');
  const fileOf = id => path.join(root, jobId(id), FILE);
  function write(receipt) {
    receipt.updated_at = now();
    const text = JSON.stringify(receipt, null, 2);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Job receipt is too large to store.');
    const file = fileOf(receipt.job_id), temp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, file);   // atomic replace: a crash leaves the previous complete receipt, never a torn one
    return receipt;
  }
  function read(id) {
    const file = fileOf(id);
    if (!fs.existsSync(file)) return null;
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (receipt?.schema !== SCHEMA || receipt.job_id !== id || !JOB_STATUSES.includes(receipt.status)
        || !RESTORE_STATUSES.includes(receipt.restore?.status) || !Array.isArray(receipt.owned) || !Array.isArray(receipt.operations))
      throw new Error('Unsupported or damaged job receipt.');
    return receipt;
  }
  function mutate(id, change) {
    const receipt = read(id);
    if (!receipt) throw new Error('No receipt exists for this job.');
    change(receipt);
    return write(receipt);
  }

  return {
    // Must succeed BEFORE the first scene change; callers treat a thrown error as "do not start".
    begin({ job_id, kind, scene_identity = null, initial_state = null, budget = null }) {
      jobId(job_id);
      if (typeof kind !== 'string' || !kind) throw new Error('A receipt needs a job kind.');
      if (fs.existsSync(fileOf(job_id))) throw new Error('A receipt already exists for this job.');
      return write({ schema: SCHEMA, job_id, kind, created_at: now(), updated_at: null, status: 'running',
        scene_identity: scene_identity == null ? null : String(scene_identity), initial_state: initial_state == null ? null : clone(initial_state),
        budget: budget == null ? null : clone(budget), owned: [], operations: [], operations_dropped: 0, last_accepted_recipe: null,
        restore: { status: 'not_needed', at: null, detail: null } });
    },
    recordOwned(id, { kind, id: ownedId, node_ids = [], evidence = 'declared', detail = null }) {
      if (!OWNED_KINDS.includes(kind) || typeof ownedId !== 'string' || !ownedId || ownedId.length > 200) throw new Error('Invalid owned item.');
      if (!['bridge_receipt', 'declared'].includes(evidence)) throw new Error('Invalid ownership evidence.');
      return mutate(id, r => {
        const entry = { kind, id: ownedId, node_ids: node_ids.map(String).slice(0, 32), evidence, detail, recorded_at: now() };
        const i = r.owned.findIndex(o => o.kind === kind && o.id === ownedId);
        if (i >= 0) r.owned[i] = { ...r.owned[i], ...entry, node_ids: [...new Set([...r.owned[i].node_ids, ...entry.node_ids])] };
        else r.owned.push(entry);
      });
    },
    recordOperation(id, { op, ok, detail = null }) {
      if (typeof op !== 'string' || !op) throw new Error('An operation receipt needs a name.');
      return mutate(id, r => {
        r.operations.push({ seq: r.operations.length + r.operations_dropped + 1, op, ok: ok !== false, at: now(), detail: detail == null ? null : String(detail).slice(0, 300) });
        while (r.operations.length > MAX_OPERATIONS) { r.operations.shift(); r.operations_dropped++; }
      });
    },
    acceptRecipe(id, recipe, label = null) {
      return mutate(id, r => { r.last_accepted_recipe = { accepted_at: now(), label, recipe: clone(recipe) }; });
    },
    setRestore(id, status, detail = null) {
      if (!RESTORE_STATUSES.includes(status)) throw new Error('Invalid restore status.');
      return mutate(id, r => { r.restore = { status, at: now(), detail: detail == null ? null : String(detail).slice(0, 300) }; });
    },
    finish(id, status) {
      if (!JOB_STATUSES.includes(status) || status === 'running') throw new Error('Invalid final job status.');
      return mutate(id, r => { r.status = status; });
    },
    get: read,
    list() {
      if (!fs.existsSync(root)) return [];
      const items = [];
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !fs.existsSync(path.join(root, entry.name, FILE))) continue;
        try { items.push(read(entry.name)); } catch (error) { items.push({ job_id: entry.name, unreadable: true, error: String(error.message || error).slice(0, 160) }); }
      }
      return items;
    },
    // A job that never finished, or whose restore is pending/failed, or whose receipt cannot be read, needs a person's decision.
    unresolved() {
      return this.list().filter(r => r.unreadable || r.status === 'running' || ['pending', 'failed'].includes(r.restore.status));
    },
  };
}

// Compare a receipt with what is actually in the scene now. `live`: { scene_identity, inventory: [{ kind, id, node_id?, name? }] }.
// Never claims an item because of its name; `lookalikePrefixes` only labels unowned items for display.
function reconcile(receipt, live, { lookalikePrefixes = [] } = {}) {
  if (!receipt || receipt.unreadable) return { scene_matches: false, owned_present: [], owned_missing: [], unowned_present: [], conflicts: ['receipt_unreadable'], allowed_actions: ['dismiss'] };
  const inventory = Array.isArray(live?.inventory) ? live.inventory : [];
  const matches = (owned, item) => owned.kind === item.kind && (owned.id === item.id
    || (item.node_id != null && owned.node_ids.includes(String(item.node_id))));
  const owned_present = receipt.owned.filter(o => inventory.some(i => matches(o, i)));
  const owned_missing = receipt.owned.filter(o => !inventory.some(i => matches(o, i)));
  const unowned_present = inventory.filter(i => !receipt.owned.some(o => matches(o, i)))
    .map(i => ({ ...i, name_lookalike: !!i.name && lookalikePrefixes.some(p => String(i.name).startsWith(p)) }));
  const scene_matches = receipt.scene_identity != null && live?.scene_identity === receipt.scene_identity;
  const conflicts = [];
  if (receipt.scene_identity == null) conflicts.push('scene_identity_not_recorded');
  else if (!scene_matches) conflicts.push('scene_changed');
  if (owned_missing.length) conflicts.push('owned_items_missing');
  if (unowned_present.some(i => i.name_lookalike)) conflicts.push('unowned_lookalikes_present');
  // Restoration is offered only for the same scene; a different or unknown scene can only be dismissed, never overwritten.
  return { scene_matches, owned_present, owned_missing, unowned_present, conflicts, allowed_actions: scene_matches ? ['restore', 'dismiss'] : ['dismiss'] };
}

module.exports = { createReceiptStore, reconcile, SCHEMA, OWNED_KINDS, RESTORE_STATUSES, JOB_STATUSES };
