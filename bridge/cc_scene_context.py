# Read-only, bounded scene context shared by the chat and specialist workflows.
# This module is exec-loaded from cc_ops.py inside KeyShot's embedded Python.


def _ctx_call(name):
    try:
        fn = getattr(lux, name, None)
        return fn() if callable(fn) else None
    except Exception:
        return None


def _ctx_scalar(value, limit=160):
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:limit]
    return None


def _ctx_vector(value):
    try:
        if hasattr(value, "val"):
            value = value.val()
        if isinstance(value, (list, tuple)) and len(value) <= 16:
            out = []
            for item in value:
                item = _ctx_scalar(item, 120)
                if item is None:
                    return None
                out.append(item)
            return out
    except Exception:
        pass
    return None


def _ctx_label(value):
    if value is None:
        return None
    direct = _ctx_scalar(value)
    if direct is not None:
        return direct
    if isinstance(value, dict):
        for key in ("name", "label", "title"):
            candidate = _ctx_scalar(value.get(key))
            if isinstance(candidate, str) and candidate.strip():
                return candidate[:160]
        return None
    if isinstance(value, (list, tuple)):
        return None
    try:
        getter = getattr(value, "getName", None)
        if callable(getter):
            named = _ctx_scalar(getter())
            if named is not None:
                return named
    except Exception:
        pass
    return None


def _ctx_node_path(node, root_id):
    names = []
    current = node
    for _ in range(24):
        try:
            if current is None or current.getID() == root_id:
                break
            name = str(current.getName() or "")[:120]
            if name:
                names.append(name)
            current = current.getParent()
        except Exception:
            break
    names.reverse()
    return names


def _ctx_bounds(node):
    try:
        box = node.getBoundingBox(world=True)
        if not isinstance(box, (list, tuple)) or len(box) != 2:
            return None
        low, high = _ctx_vector(box[0]), _ctx_vector(box[1])
        if low is None or high is None or len(low) != 3 or len(high) != 3:
            return None
        return [low, high]
    except Exception:
        return None


def _ctx_selected_nodes(limit=8, scan_limit=5000):
    root = lux.getSceneTree()
    root_id = root.getID()
    try:
        nodes = root.find("")
    except Exception:
        nodes = []
    try:
        geometry_ids = set(lux.getObjects())
    except Exception:
        geometry_ids = set()

    selected = []
    scanned = 0
    for node in nodes:
        scanned += 1
        if scanned > scan_limit:
            break
        try:
            if node.isDeleted():
                continue
            try:
                is_selected = bool(node.isSelected())
            except Exception:
                getter = getattr(node, "getSelected", None)
                is_selected = bool(getter()) if callable(getter) else False
            if not is_selected:
                continue
            node_id = node.getID()
            record = {
                "node_id": node_id,
                "name": str(node.getName() or "")[:160],
                "kind": _ctx_scalar(node.getKind()),
                "path": _ctx_node_path(node, root_id),
                "bounds": _ctx_bounds(node),
                "hidden": bool(node.isHidden()),
                "locked": bool(node.isLocked()),
            }
            try:
                layer = node.getRenderLayer()
                record["render_layer"] = _ctx_label(layer)
            except Exception:
                pass
            if node_id in geometry_ids:
                try:
                    material = lux.getObjectMaterial(node_id)
                    if isinstance(material, (list, tuple)):
                        material = material[0] if material else None
                    record["material"] = _ctx_label(material)
                except Exception:
                    pass
            selected.append(record)
            if len(selected) >= limit:
                break
        except Exception:
            continue
    return selected, scanned > scan_limit


def _ctx_director_lights(limit=12):
    registry = globals().get("REG")
    if not isinstance(registry, dict):
        return []
    out = []
    for light_id, entry in list(registry.items())[:limit]:
        spec = entry.get("spec", {}) if isinstance(entry, dict) else {}
        if not isinstance(spec, dict):
            spec = {}
        record = {"id": str(light_id)[:80]}
        for key in ("role", "type", "az", "el", "d", "w", "h", "gain", "kelvin", "angle", "falloff", "rgb"):
            value = spec.get(key)
            clean = _ctx_vector(value) if isinstance(value, (list, tuple)) else _ctx_scalar(value)
            if clean is not None:
                record[key] = clean
        out.append(record)
    return out


def op_scene_context(c):
    """Return a compact current-scene summary. Reads KeyShot state; never edits or renders."""
    allowed = {"op"}
    unknown = set(c) - allowed
    if unknown:
        raise ValueError("unsupported scene context input: %s" % sorted(unknown)[0])

    raw_scene = {}
    try:
        value = lux.getSceneInfo()
        if isinstance(value, dict):
            raw_scene = value
    except Exception:
        pass
    raw_file = str(raw_scene.get("file", "") or "").replace("\\", "/")
    display_name = raw_file.rsplit("/", 1)[-1] if raw_file else None
    scene = {"display_name": display_name}
    for source, target in (("unit", "unit"), ("unitScale", "unit_scale"),
                           ("objects", "object_count"), ("triangles", "triangle_count"),
                           ("nurbs", "nurbs_count"), ("curves", "curve_count"),
                           ("width", "render_width"), ("height", "render_height")):
        value = _ctx_scalar(raw_scene.get(source))
        if value is not None:
            scene[target] = value
    size = _ctx_vector(raw_scene.get("size"))
    if size is not None:
        scene["size"] = size

    camera = {}
    try:
        current = read_camera()
        if isinstance(current, dict):
            for key in ("name", "pos", "pivot", "dir", "lookat", "up", "dist", "fov", "focal"):
                value = current.get(key)
                clean = _ctx_vector(value) if isinstance(value, (list, tuple)) else _ctx_scalar(value)
                if clean is not None:
                    camera[key] = clean
    except Exception:
        pass
    lens_value = _ctx_call("getCameraLens")
    if isinstance(lens_value, dict):
        lens_parameters = {}
        for key in ("lens", "fov", "perspective", "shift"):
            raw = lens_value.get(key)
            clean = _ctx_vector(raw) if isinstance(raw, (list, tuple)) else _ctx_scalar(raw)
            if clean is not None:
                lens_parameters[key] = clean
        if lens_parameters:
            camera["lens_parameters"] = lens_parameters
        for key in ("lens_type", "type", "name"):
            label = _ctx_label(lens_value.get(key))
            if label is not None:
                camera["lens_type"] = label
                break
    else:
        lens_label = _ctx_label(lens_value)
        if lens_label is not None:
            camera["lens_type"] = lens_label
    if "lens_type" not in camera:
        lens_type = _ctx_label(_ctx_call("getCameraLensType"))
        if lens_type is not None:
            camera["lens_type"] = lens_type

    active = {}
    for key, method in (("studio", "getActiveStudio"), ("configuration", "getActiveConfiguration"),
                        ("model_set", "getActiveModelSet"), ("image_style", "getActiveImageStyle")):
        value = _ctx_call(method)
        if value is not None:
            label = _ctx_label(value)
            if label is not None:
                active[key] = label

    environment = {}
    try:
        value = op_env_info({})
        if isinstance(value, dict):
            for key in ("name", "brightness", "rotation", "bg", "ground_shadows", "ground_reflections", "size", "height"):
                if key not in value:
                    continue
                raw = value[key]
                clean = _ctx_vector(raw) if isinstance(raw, (list, tuple)) else _ctx_scalar(raw)
                if clean is not None:
                    environment[{"bg": "background_rgb"}.get(key, key)] = clean
            hdri = value.get("hdri")
            if hdri:
                # HDRI may be an absolute file path; expose only its local asset name.
                environment["hdri_name"] = str(hdri).replace("\\", "/").rsplit("/", 1)[-1][:160]
    except Exception:
        pass

    selected, selection_truncated = _ctx_selected_nodes()
    subject = None
    try:
        subject = op_subject({})
        if isinstance(subject, dict):
            subject = {key: subject.get(key) for key in ("models", "min", "max", "size", "center", "span") if key in subject}
    except Exception:
        subject = None

    errors = []
    if not raw_scene:
        errors.append("scene_info_unavailable")
    if selection_truncated:
        errors.append("selection_scan_capped_at_5000_nodes")
    if not selected:
        errors.append("no_selected_scene_node_found")

    return {
        "schema_version": "1.0",
        "read_only": True,
        "scene": scene,
        "active": active,
        "camera": camera,
        "environment": environment,
        "target": {"selection": selected, "selection_limit": 8, "product_bounds": subject},
        "lighting": {"director_managed": _ctx_director_lights(), "source_limit": 12},
        "render": {"engine": _ctx_label(_ctx_call("getRenderEngine")),
                   "image_size": [scene.get("render_width"), scene.get("render_height")]},
        "limits": ["Scene names, paths, and bounds do not identify semantic features such as buttons, logos, or bevels.",
                   "Only selected parts include material assignments; full material graphs are fetched on demand.",
                   "Private scene and texture file paths are omitted."],
        "read_notes": errors,
    }


SCENE_CONTEXT_OPS = {"scene_context": op_scene_context}
