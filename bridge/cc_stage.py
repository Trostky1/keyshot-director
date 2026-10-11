# Scene staging. Native Matrix checkpoints preserve complete leaf transforms,
# including imported scale/shear. Ownership is recorded by identity, never name.
import sys, types, uuid

_SG = sys.modules.get('cc_stage_state')
if _SG is None:
    _SG = types.ModuleType('cc_stage_state')
    sys.modules['cc_stage_state'] = _SG
STAGE = _SG.__dict__.setdefault('state', {'undo': [], 'owned': set()})


def stage_children(n):
    if n.isObject() or n.isCamera() or n.isAnimation():
        return []
    return [p for p in n.getChildren() if not p.isDeleted()]


def stage_nodes():
    out = []
    def walk(n):
        if n.isDeleted():
            return
        out.append(n)
        for child in stage_children(n):
            walk(child)
    walk(lux.getSceneTree())
    return out


def stage_vec(value, default, limit=100000):
    v = default if value is None else value
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        raise ValueError('Expected three numeric coordinates')
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > limit for x in v):
        raise ValueError('Coordinates must be finite and within limits')
    return [float(x) for x in v]


def stage_eligible(n):
    # No model sets/root, lights, cameras or animations; no inferred ownership.
    if n.getID() == lux.getSceneTree().getID() or n.getKind() == lux.NODE_TYPE_MODEL_SET:
        return False
    if n.getName().startswith('CC_L_') or n.isCamera() or n.isAnimation():
        return False
    if n.getID() in STAGE['owned']:
        return True
    if n.isModel():
        return True
    if n.isObject() or n.isGroup():
        model_ids = {p.getID() for p in lux.getSceneTree().find(types=lux.NODE_TYPE_MODEL)}
        p = n.getParent()
        while p:
            if p.getID() == lux.getSceneTree().getID() or p.getName().startswith('CC_L_'):
                return False
            # getParent() can wrap a MODEL as kind GROUP in KeyShot 2026.2.
            # Its stable ID, not that wrapper's kind, establishes ancestry.
            if p.getID() in model_ids:
                return not p.getName().startswith('CC_L_')
            if p.getKind() == lux.NODE_TYPE_MODEL_SET:
                break
            p = p.getParent()
    return False


def stage_find(oid, check_locks=True):
    if isinstance(oid, bool) or not isinstance(oid, int):
        raise ValueError('Use a numeric node_id from scene_objects')
    found = [n for n in stage_nodes() if n.getID() == oid and stage_eligible(n)]
    if not found:
        raise ValueError('Object no longer exists or cannot be staged; refresh scene_objects')
    n = found[0]
    if not check_locks:
        return n
    if n.isLocked():
        raise ValueError('Object is locked in KeyShot; unlock it explicitly first')
    parent = n.getParent()
    while parent.getID() != lux.getSceneTree().getID():
        if parent.isLocked():
            raise ValueError('A parent assembly is locked in KeyShot')
        parent = parent.getParent()
    return n


def stage_refresh_geometry(n):
    # KeyShot NURBS models can cache obsolete assembly bounds. An identity
    # assembly transform invalidates that cache without moving geometry.
    n.applyTransform(luxmath.Matrix().makeIdentity())
    lux.sync()
    return [p for p in stage_nodes() if p.getID() == n.getID()][0]


def stage_leaves(n):
    leaves = []
    geometry_ids = set(lux.getObjects())  # NURBS geometry can be exposed as group nodes.
    def walk(p):
        if p.isLocked():
            raise ValueError('Assembly contains locked geometry or groups')
        if p.isObject() or p.getID() in geometry_ids:
            if p.isLocked():
                raise ValueError('Assembly contains locked geometry')
            leaves.append(p)
        for child in stage_children(p):
            walk(child)
    walk(n)
    if not leaves:
        raise ValueError('No editable geometry in this node')
    return leaves


def stage_info(n):
    bb = n.getBoundingBox(world=True)
    lo, hi = [float(x) for x in bb[0].val()], [float(x) for x in bb[1].val()]
    return {'node_id': n.getID(), 'name': n.getName()[:160], 'kind': n.getKind(),
            'parent_id': n.getParent().getID(), 'owned': n.getID() in STAGE['owned'],
            'hidden': n.isHidden(), 'locked': n.isLocked(), 'bounds': [lo, hi],
            'center': [(lo[i] + hi[i]) / 2 for i in range(3)],
            'size': [hi[i] - lo[i] for i in range(3)]}


def op_scene_objects(c):
    nodes = [n for n in stage_nodes() if stage_eligible(n)]
    if c.get('node_id') is not None:
        parent = stage_find(c['node_id'], check_locks=False)
        nodes = [n for n in stage_children(parent) if not n.isDeleted() and stage_eligible(n)]
    else:
        nodes = [n for n in nodes if n.isModel() or n.getParent().getKind() == lux.NODE_TYPE_MODEL_SET]
    offset = c.get('offset', 0)
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError('Inventory offset must be a non-negative integer')
    return {'objects': [stage_info(n) for n in nodes[offset:offset + 8]],
            'total': len(nodes), 'next_offset': offset + 8 if offset + 8 < len(nodes) else None,
            'scene': lux.getSceneInfo(), 'coordinate_space': 'world, Y up; native scene coordinates',
            'undo_count': len(STAGE['undo'])}


def stage_capture(n):
    return [(leaf, luxmath.Matrix(leaf.getTransform(world=True).val())) for leaf in stage_leaves(n)]


def stage_restore(record):
    # Preflight all identities before touching anything; scene changes invalidate undo.
    current_nodes = {n.getID(): n for n in stage_nodes()}
    ids = set(current_nodes)
    if any(n.isDeleted() or n.getID() not in ids for n, m in record['transforms']):
        raise ValueError('Scene changed outside Director; this staging undo is no longer safe')
    if record.get('node') is not None:
        expected_ids = {n.getID() for n, m in record['transforms']}
        current_geometry = {n.getID() for n in stage_leaves(stage_find(record['node'].getID()))}
        if current_geometry != expected_ids:
            raise ValueError('Assembly geometry changed outside Director; undo would affect new geometry')
        for oid, expected in record.get('after', {}).items():
            actual = current_nodes[oid].getTransform(world=True).val()
            if any(abs(a - b) > .00001 for a, b in zip(actual, expected)):
                raise ValueError('Geometry moved outside Director; refusing to overwrite that edit')
    for n in record['created']:
        if not n.isDeleted() and n.getID() in ids:
            if n.getID() not in STAGE['owned'] or any(p.getID() not in STAGE['owned'] for p in stage_subtree(n)):
                raise ValueError('Created object now contains user-added geometry; undo would remove it')
    if record.get('inverse') is not None:
        record['node'].applyTransform(record['inverse'])
        lux.sync()
        return
    for n, matrix in record['transforms']:
        if n.isObject():
            n.applyTransform(matrix, absolute=True)
        else:
            # KeyShot represents native NURBS objects as terminal groups and rejects
            # absolute group transforms. Recover the original using a relative delta.
            current = luxmath.Matrix(current_nodes[n.getID()].getTransform(world=True).val())
            if not current.invert():
                raise ValueError('Current geometry transform cannot be inverted')
            n.applyTransform(matrix.mul(current))
    for n in record['created']:
        if not n.isDeleted() and n.getID() in ids:
            n.delete()
            STAGE['owned'].difference_update(p.getID() for p in stage_subtree(n))
    lux.sync()


def stage_subtree(n):
    out = [n]
    for child in stage_children(n):
        out.extend(stage_subtree(child))
    return out


def stage_commit(record, objects):
    for n in objects:
        stage_refresh_geometry(n)
    lux.sync()
    fresh = {n.getID(): n for n in stage_nodes()}
    result = [stage_info(fresh[n.getID()]) for n in objects]
    if record.get('node') is not None:
        record['after'] = {n.getID(): tuple(fresh[n.getID()].getTransform(world=True).val()) for n, m in record['transforms']}
    STAGE['undo'].append(record)
    STAGE['undo'] = STAGE['undo'][-20:]
    return {'objects': result, 'undo_count': len(STAGE['undo'])}


def stage_transform(n, translation, rotation, scale):
    center = tuple(float(x) for x in n.getCenter(world=True).val())
    matrix = luxmath.Matrix().makeIdentity().translate(luxmath.Vector(tuple(-x for x in center)))
    matrix = matrix.scale(scale)
    for axis, angle in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), rotation):
        matrix = matrix.rotateAroundAxis(luxmath.Vector(axis), angle)
    matrix = matrix.translate(luxmath.Vector(tuple(center[i] + translation[i] for i in range(3))))
    # Native assembly transforms are local; conjugate the world delta once at
    # the assembly level. Transforming NURBS leaves separately leaves stale
    # native assembly bounds. Invert the EXACT applied delta for assembly undo.
    original = luxmath.Matrix(n.getTransform(world=True).val())
    inverse = luxmath.Matrix(original.val())
    if not inverse.invert():
        raise ValueError('Geometry transform cannot be inverted')
    relative = original.mul(matrix).mul(inverse)
    undo = luxmath.Matrix(relative.val())
    if not undo.invert():
        raise ValueError('Staging delta cannot be inverted')
    n.applyTransform(relative)
    return undo


def op_stage_transform(c):
    n = stage_find(c.get('node_id'))
    translation = stage_vec(c.get('translation'), [0, 0, 0])
    rotation = stage_vec(c.get('rotation'), [0, 0, 0], 3600)
    scale = c.get('scale', 1)
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not .1 <= scale <= 10:
        raise ValueError('Uniform scale must be 0.1–10')
    position = stage_vec(c['position'], [0, 0, 0]) if c.get('position') is not None else None
    stage_leaves(n)  # preflight locks before cache invalidation
    n = stage_refresh_geometry(n)
    if position is not None:
        center = [float(x) for x in n.getCenter(world=True).val()]
        translation = [position[i] - center[i] for i in range(3)]
    record = {'transforms': stage_capture(n), 'created': []}
    try:
        record['node'] = n
        record['inverse'] = stage_transform(n, translation, rotation, scale)
        return stage_commit(record, [n])
    except Exception:
        stage_restore(record)
        raise


def op_stage_duplicate(c):
    n = stage_find(c.get('node_id'))
    stage_leaves(n)  # locked-child check before native duplication
    count = c.get('count', 1)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 8:
        raise ValueError('Create 1–8 additional copies at a time')
    offset = stage_vec(c.get('offset'), [0, 0, 0])
    rotation = stage_vec(c.get('rotation'), [0, 0, 0], 3600)
    if not isinstance(c.get('linked_materials', True), bool):
        raise ValueError('linked_materials must be boolean')
    n = stage_refresh_geometry(n)
    source_center = stage_info(n)['center']
    record = {'transforms': [], 'created': []}
    parent = n.getParent()
    before = {p.getID() for p in stage_nodes()}
    try:
        n.duplicate(amount=count, linkMats=c.get('linked_materials', True))
        lux.sync()
        added = [p for p in stage_nodes() if p.getID() not in before]
        STAGE['owned'].update(p.getID() for p in added)
        roots = [p for p in added if p.getParent().getID() == parent.getID()]
        record['created'] = roots
        if len(roots) != count:
            raise ValueError('Native duplication returned an unexpected assembly structure')
        for i, root in enumerate(roots):
            root.setName('CC_S_Copy_' + uuid.uuid4().hex[:8])
            root = stage_refresh_geometry(root)
            center = stage_info(root)['center']
            delta = [source_center[j] + offset[j] * (i + 1) - center[j] for j in range(3)]
            stage_transform(root, delta, [x * (i + 1) for x in rotation], 1)
        return stage_commit(record, roots)
    except Exception:
        # Register/collect even if native duplication raised after creating geometry.
        added = [p for p in stage_nodes() if p.getID() not in before]
        STAGE['owned'].update(p.getID() for p in added)
        record['created'] = [p for p in added if p.getParent().getID() == parent.getID()]
        stage_restore(record)
        raise


def op_stage_set(c):
    kind = c.get('kind', 'pedestal')
    if kind not in ('pedestal', 'floor', 'backdrop'):
        raise ValueError('Set piece must be pedestal, floor or backdrop')
    size = stage_vec(c.get('size'), [100, 100, 100])
    if any(x < .01 for x in size):
        raise ValueError('Set piece dimensions must be positive')
    position = stage_vec(c.get('position'), [0, 0, 0])
    rotation = stage_vec(c.get('rotation'), [0, 0, 0], 3600)
    # Thin slabs are true geometry and can cast shadows/appear in reflections.
    name = 'CC_S_' + kind + '_' + uuid.uuid4().hex[:8]
    asset = os.path.join(os.path.dirname(SHOTS), 'assets', 'cc_stage_cube.obj')
    before = {p.getID() for p in stage_nodes()}
    record = {'transforms': [], 'created': []}
    try:
        opts = lux.getImportOptions(ext='obj', getDefaults=True)
        opts.update({'adjust_camera_look_at': False, 'adjust_environment': False, 'camera_import': False,
                     'center_geometry': False, 'snap_to_ground': False, 'import_type': 0,
                     'geometry_units': 1000.0, 'up_vector': 1, 'same_coordinates': True})
        lux.importFile(asset, showOpts=False, dontAsk=True, opts=opts)
        lux.sync()
        added = [p for p in stage_nodes() if p.getID() not in before]
        STAGE['owned'].update(p.getID() for p in added)
        roots = [p for p in added if p.getParent().getID() in before]
        record['created'] = roots
        if not roots:
            raise ValueError('Set piece import produced no geometry')
        leaves = [p for p in added if p.isObject()]
        matrix = luxmath.Matrix().makeIdentity().scale(luxmath.Vector(size))
        for axis, angle in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), rotation):
            matrix = matrix.rotateAroundAxis(luxmath.Vector(axis), angle)
        matrix = matrix.translate(luxmath.Vector(position))
        for p in leaves:
            p.applyTransform(matrix, absolute=True)
        for root in roots:
            root.setName(name)
        # Import's neutral diffuse material is deliberately retained. Material editing
        # is left to KeyShot until a separately validated set-material control exists.
        return stage_commit(record, roots)
    except Exception:
        added = [p for p in stage_nodes() if p.getID() not in before]
        STAGE['owned'].update(p.getID() for p in added)
        record['created'] = [p for p in added if p.getParent().getID() in before]
        stage_restore(record)
        raise


def op_stage_undo(c):
    if not STAGE['undo']:
        raise ValueError('No staging operation to undo in this KeyShot session')
    record = STAGE['undo'][-1]
    stage_restore(record)
    STAGE['undo'].pop()
    return {'restored': True, 'undo_count': len(STAGE['undo'])}


STAGE_OPS = {'scene_objects': op_scene_objects, 'stage_transform': op_stage_transform,
             'stage_duplicate': op_stage_duplicate, 'stage_set': op_stage_set, 'stage_undo': op_stage_undo}
