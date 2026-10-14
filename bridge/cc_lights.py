# cc_lights.py - lighting engine, runs inside KeyShot (exec'd by cc_ops.py; shares its namespace).
# A "light" is a flat rectangular panel (imported OBJ plane) with a KeyShot library area-light
# material whose power / colour / visibility we edit through the material graph.
# Everything we create is named CC_L_<id> and registered, so it can be updated or removed without
# touching the user's product.  Lights are placed in world space (mm) and aimed at a target point.
import math, os

PANEL_OBJ = os.path.join(os.path.dirname(SHOTS), "assets", "cc_light_panel.obj")
PREFIX = "CC_L_"
LIB_LIGHT = "Area Light 1200 Lumen White"
LIGHT_LIBRARY_MATERIALS = {
    "area": LIB_LIGHT,
    "point": "Point Light 1200 Lumen White",
    "spotlight": "Spotlight 45 degrees 1200 Lumen Neutral",
}
LIGHT_SHADER_NAMES = {
    "area": "lux_mesh_light",
    "point": "lux_point_light",
    "ies": "lux_ies_light",
    "spotlight": "lux_spotlight",
}
ENV_NAME = "CC_Studio"
ENV_DIR = lux.getKeyShotFolder(lux.FOLDER_ENVIRONMENTS).replace("\\", "/").rstrip("/") + "/"
import sys, types
# State lives in sys.modules so it survives hot reloads of this file (and re-running the bridge in the same
# KeyShot session): otherwise a reload would forget lights that still exist in the scene.
_ST = sys.modules.get("cc_state")
if _ST is None:
    _ST = types.ModuleType("cc_state"); sys.modules["cc_state"] = _ST
REG = _ST.__dict__.setdefault("REG", {})                 # id -> {"obj_id", "mat", "spec"}
ENV_STATE = _ST.__dict__.setdefault("ENV_STATE", {"prev": None})


# ---- small vector helpers (plain tuples; no luxmath dependence for the maths) ----------
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _len(a): return math.sqrt(_dot(a, a))
def _norm(a):
    n = _len(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _rodrigues(v, axis, deg):
    k = _norm(axis); a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return _add(_add(_mul(v, c), _mul(_cross(k, v), s)), _mul(k, _dot(k, v) * (1 - c)))


def kelvin_to_rgb(k):
    """Colour temperature -> RGB 0..1 (Tanner Helland fit), max channel normalised to 1."""
    t = max(1000.0, min(40000.0, float(k))) / 100.0
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [max(0.0, min(255.0, x)) / 255.0 for x in (r, g, b)]
    m = max(c) or 1.0
    return tuple(x / m for x in c)


# ---- panel placement ---------------------------------------------------------------------
def panel_matrix(pos, target, size, roll=0.0):
    """Matrix placing the 100x100 unit panel: scaled to size (mm), normal (+Z) facing target,
    panel 'up' kept toward world up (strips stand upright) plus optional roll (deg)."""
    d = _norm(_sub(target, pos))
    z = (0.0, 0.0, 1.0)
    axis = _cross(z, d)
    ang = math.degrees(math.acos(max(-1.0, min(1.0, _dot(z, d)))))
    if _len(axis) < 1e-6:
        axis = (0.0, 1.0, 0.0)                       # looking straight along +-Z: any perpendicular axis
    y1 = _rodrigues((0.0, 1.0, 0.0), axis, ang)      # where panel-up ends up after the aim rotation
    up = (0.0, 1.0, 0.0)
    want = _sub(up, _mul(d, _dot(up, d)))
    if _len(want) < 1e-6:
        want = (0.0, 0.0, -1.0 if d[1] > 0 else 1.0) # looking straight down/up: pick a stable up
    want = _norm(want)
    roll_to_up = math.degrees(math.atan2(_dot(_cross(y1, want), d), _dot(y1, want)))
    M = luxmath.Matrix().makeIdentity().scale(luxmath.Vector((size[0] / 100.0, size[1] / 100.0, 1.0)))
    M = M.rotateAroundAxis(luxmath.Vector(_norm(axis)), ang)
    M = M.rotateAroundAxis(luxmath.Vector(d), roll_to_up + roll)
    M = M.translate(luxmath.Vector(pos))
    return M, d, roll_to_up + roll


def spotlight_matrix(pos, target, roll=0.0):
    """Aim a KeyShot Spotlight's observed local -Y emission axis toward target."""
    d = _norm(_sub(target, pos))
    source_axis = (0.0, -1.0, 0.0)
    axis = _cross(source_axis, d)
    dot = max(-1.0, min(1.0, _dot(source_axis, d)))
    angle = math.degrees(math.acos(dot))
    if _len(axis) < 1e-6:
        axis = (0.0, 0.0, 1.0) if dot < 0 else (1.0, 0.0, 0.0)
    else:
        axis = _norm(axis)
    M = luxmath.Matrix().makeIdentity()
    if angle > 1e-6:
        M = M.rotateAroundAxis(luxmath.Vector(axis), angle)

    # Keep the light's local +Z axis stable around the aimed beam. This controls
    # twist but leaves the verified local -Y emission direction unchanged.
    z1 = _rodrigues((0.0, 0.0, 1.0), axis, angle)
    up = (0.0, 1.0, 0.0)
    desired = _sub(up, _mul(d, _dot(up, d)))
    if _len(desired) < 1e-6:
        desired = (0.0, 0.0, 1.0)
    desired = _norm(desired)
    roll_to_up = math.degrees(math.atan2(_dot(_cross(z1, desired), d), _dot(z1, desired)))
    M = M.rotateAroundAxis(luxmath.Vector(d), roll_to_up + roll)
    M = M.translate(luxmath.Vector(pos))
    return M, d, roll_to_up + roll


def expected_bbox(pos, target, size, roll_total, d):
    """Where the 4 panel corners should be, computed independently of KeyShot's matrix maths."""
    z = (0.0, 0.0, 1.0)
    axis = _cross(z, d)
    ang = math.degrees(math.acos(max(-1.0, min(1.0, _dot(z, d)))))
    if _len(axis) < 1e-6: axis = (0.0, 1.0, 0.0)
    pts = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p = (sx * size[0] / 2.0, sy * size[1] / 2.0, 0.0)
        p = _rodrigues(p, axis, ang)
        p = _rodrigues(p, d, roll_total)
        pts.append(_add(p, pos))
    lo = tuple(min(p[i] for p in pts) for i in range(3)); hi = tuple(max(p[i] for p in pts) for i in range(3))
    return lo, hi


# ---- node / material helpers ---------------------------------------------------------------
def _scene_nodes():
    """Return live scene-tree nodes without relying on a name or on the current selection."""
    out = []
    def walk(node):
        if node.isDeleted():
            return
        out.append(node)
        if node.isObject() or node.isCamera() or node.isAnimation():
            return
        for child in node.getChildren():
            walk(child)
    walk(lux.getSceneTree())
    return out


def _scene_unit_snapshot():
    info = lux.getSceneInfo()
    return {"unit": str(info.get("unit", "unknown")).lower(),
            "unitScale": float(info.get("unitScale", 0.0) or 0.0)}


def _delete_created_nodes(node_ids, geometry_ids):
    """Delete only scene nodes and mesh IDs that appeared during this import."""
    wanted = set(node_ids or ())
    geometry_ids = set(geometry_ids or ())
    errors = []
    try:
        nodes = {node.getID(): node for node in _scene_nodes()}
    except Exception as exc:
        return {"remaining_nodes": sorted(wanted), "remaining_geometry": sorted(geometry_ids),
                "errors": ["scene tree read failed: %s" % str(exc)[:160]]}

    # Delete geometry leaves first. Deleting their import-created group first can
    # detach a mesh while leaving it in lux.getObjects().
    for node_id in sorted(wanted):
        node = nodes.get(node_id)
        if node is None or node.isDeleted():
            continue
        try:
            children = [] if node.isObject() else [child for child in node.getChildren() if not child.isDeleted()]
            if node.isObject() or (node_id in geometry_ids and not children):
                node.delete()
        except Exception as exc:
            errors.append("node %s delete failed: %s" % (node_id, str(exc)[:120]))
    try:
        lux.sync()
    except Exception as exc:
        errors.append("sync after geometry delete failed: %s" % str(exc)[:120])

    # Then remove only empty groups created by the import. Never delete an
    # existing parent/model set or a group that gained user-owned children.
    try:
        nodes = {node.getID(): node for node in _scene_nodes()}
        for node_id in sorted(wanted, reverse=True):
            node = nodes.get(node_id)
            if node is None or node.isDeleted():
                continue
            children = [] if node.isObject() else [child for child in node.getChildren() if not child.isDeleted()]
            if not children:
                node.delete()
        lux.sync()
    except Exception as exc:
        errors.append("empty import-group cleanup failed: %s" % str(exc)[:120])

    try:
        live_nodes = {node.getID() for node in _scene_nodes()}
        live_geometry = set(lux.getObjects())
    except Exception as exc:
        return {"remaining_nodes": sorted(wanted), "remaining_geometry": sorted(geometry_ids),
                "errors": errors + ["post-cleanup inventory failed: %s" % str(exc)[:120]]}
    remaining_nodes = sorted(wanted & live_nodes)
    remaining_geometry = sorted(geometry_ids & live_geometry)
    return {"remaining_nodes": remaining_nodes, "remaining_geometry": remaining_geometry,
            "errors": errors}


def _restore_scene_unit(snapshot):
    unit = snapshot.get("unit", "unknown")
    const = getattr(lux, "UNIT_" + unit.upper(), None)
    if const is None:
        return False
    lux.setSceneUnit(const, True)
    lux.sync()
    after = _scene_unit_snapshot()
    return after["unit"] == unit and abs(after["unitScale"] - snapshot["unitScale"]) < 1e-6


def _material_name(value):
    return value[0] if isinstance(value, (list, tuple)) and value else (value or "")


def _material_in_use(material, exclude_ids=()):
    if not material:
        return False
    excluded = set(exclude_ids or ())
    geometry_ids = set(lux.getObjects())
    for node in _scene_nodes():
        if not node.isObject() and node.getID() not in geometry_ids:
            continue
        if node.getID() in excluded:
            continue
        try:
            if _material_name(lux.getObjectMaterial(node.getID())) == material:
                return True
        except Exception:
            continue
    return False


def _delete_unused_material(material):
    if not material or _material_in_use(material):
        return False
    if material in lux.getSceneMaterials():
        lux.deleteMaterial(material)
        lux.sync()
    return material not in lux.getSceneMaterials()


def _import_panel():
    # The panel API is expressed in millimeters. Importing an OBJ can set KeyShot's
    # scene units, so refuse unspecified/non-mm scenes rather than silently changing
    # the product's lighting and material scale.
    units_before = _scene_unit_snapshot()
    if units_before["unit"] != "mm" or abs(units_before["unitScale"] - 1000.0) > 1e-6:
        raise RuntimeError("Director Area Light geometry uses millimeters, but this scene's units are %s (scale %s). Set the KeyShot scene units to millimeters before adding Director lights; no geometry was imported." %
                           (units_before["unit"], units_before["unitScale"]))

    before_nodes = {node.getID() for node in _scene_nodes()}
    before_geometry = set(lux.getObjects())
    o = lux.getImportOptions(ext="obj", getDefaults=True)
    o.update({"adjust_camera_look_at": False, "adjust_environment": False, "camera_import": False,
              "center_geometry": False, "snap_to_ground": False, "import_type": 0, "geometry_units": 1000.0,
              "up_vector": 1, "inclusion_options": 1, "include_nurbs": False,
              "separate_materials": True, "same_coordinates": True})
    try:
        imported = lux.importFile(PANEL_OBJ, showOpts=False, dontAsk=True, opts=o)
        if imported is False:
            raise RuntimeError("panel import was cancelled or failed")
        lux.sync()
        after_nodes = {node.getID(): node for node in _scene_nodes()}
        created_node_ids = set(after_nodes) - before_nodes
        created_geometry_ids = set(lux.getObjects()) - before_geometry
        units_after = _scene_unit_snapshot()
        if units_after != units_before:
            raise RuntimeError("panel import changed scene units from %s/%s to %s/%s" %
                               (units_before["unit"], units_before["unitScale"],
                                units_after["unit"], units_after["unitScale"]))
        cands = lux.getSceneTree().find(name="cc_light_panel", types=lux.NODE_TYPE_OBJECT)
        matches = [node for node in cands if node.getID() in created_node_ids]
        if len(matches) != 1:
            raise RuntimeError("expected one newly imported panel object; found %s" % len(matches))
        return matches[0], sorted(created_node_ids), sorted(created_geometry_ids), units_before
    except Exception as exc:
        try:
            after_node_ids = {node.getID() for node in _scene_nodes()}
            added_node_ids = after_node_ids - before_nodes
            added_geometry_ids = set(lux.getObjects()) - before_geometry
            cleanup = _delete_created_nodes(added_node_ids, added_geometry_ids)
            current_units = _scene_unit_snapshot()
            if current_units != units_before and not _restore_scene_unit(units_before):
                cleanup["errors"].append("scene unit restoration could not be verified")
            if cleanup["remaining_nodes"] or cleanup["remaining_geometry"] or cleanup["errors"]:
                raise RuntimeError("panel import failed (%s); rollback incomplete: %s" %
                                   (str(exc)[:180], cleanup))
        except Exception as cleanup_error:
            raise RuntimeError("panel import failed (%s); rollback failed (%s)" %
                               (str(exc)[:180], str(cleanup_error)[:240]))
        raise


def _light_node(oid, lid=None):
    # Resolve by stable identity first; names can be changed by users or older
    # Director versions, so they must never decide which object gets deleted.
    for node in _scene_nodes():
        if node.getID() != oid:
            continue
        name = node.getName() or ""
        if node.isObject() and name.startswith(PREFIX):
            return node
    return None


def _light_graph_node(mname, expected_type=None):
    g = lux.getMaterialGraph(mname)
    for n in g.getNodes():
        t = n.getType()
        kind = str(t.get("name", "")) if isinstance(t, dict) else str(t)
        if kind == (expected_type or "lux_mesh_light"):
            return n
    return None


def _resolve_ies_asset(asset_id):
    """Resolve a catalog-relative IES MTL and verify the matching installed profile."""
    import re
    asset_id = str(asset_id or "").replace("\\", "/")
    if not asset_id.startswith("Light/IES Light/") or ".." in asset_id.split("/") or not asset_id.lower().endswith(".mtl"):
        raise ValueError("ies_asset_id must be an installed relative path under Light/IES Light")
    material_root = os.path.abspath(lux.getKeyShotFolder(lux.FOLDER_MATERIALS))
    mtl_path = os.path.abspath(os.path.join(material_root, *asset_id.split("/")))
    if os.path.commonpath((material_root, mtl_path)) != material_root or not os.path.isfile(mtl_path):
        raise ValueError("The requested IES material is outside the installed library or is missing")
    with open(mtl_path, "r", encoding="utf-8", errors="replace") as source:
        content = source.read()
    if "lux_ies_light" not in content:
        raise ValueError("The selected MTL file does not declare a lux_ies_light graph")
    profile_match = re.search(r'"file"\s+"([^"]+)"', content)
    if not profile_match:
        raise ValueError("The selected IES material does not name a photometric profile")
    profile_name = os.path.basename(profile_match.group(1).replace("\\", "/"))
    ies_root = os.path.join(material_root, "Light", "IES Light")
    profile_root = os.path.join(os.path.dirname(material_root), "Textures", "IES Profiles")
    profile_path = os.path.join(profile_root, os.path.relpath(os.path.dirname(mtl_path), ies_root), profile_name)
    if not os.path.isfile(profile_path):
        profile_path = ""
        for directory, subdirs, names in os.walk(profile_root):
            subdirs.sort(key=str.lower)
            match = next((name for name in names if name.lower() == profile_name.lower()), None)
            if match:
                profile_path = os.path.join(directory, match)
                break
    if not profile_path:
        raise ValueError("The IES material's referenced profile is not present in the installed IES Profiles folder")
    return {"asset_id": asset_id, "mtl_path": mtl_path, "profile_name": profile_name,
            "profile_relative_path": os.path.relpath(profile_path, profile_root).replace("\\", "/")}


def _material_names_from_load(result):
    if isinstance(result, str):
        return [result]
    if isinstance(result, (list, tuple, set)):
        return list(dict.fromkeys(str(value) for value in result if value))
    return []


def _load_ies_scene_material(asset_id):
    asset = _resolve_ies_asset(asset_id)
    before = set(lux.getSceneMaterials())
    loader = getattr(lux, "loadMaterials", None)
    if not callable(loader):
        raise RuntimeError("This KeyShot runtime does not expose the documented in-project MTL material loader")
    loaded_result = loader(asset["mtl_path"])
    lux.sync()
    loaded_names = _material_names_from_load(loaded_result)
    candidates = list(dict.fromkeys(loaded_names + sorted(set(lux.getSceneMaterials()) - before) + sorted(before)))
    for name in candidates:
        try:
            graph = lux.getMaterialGraph(name)
            for node in graph.getNodes():
                if _lighting_lab_type(node) != "lux_ies_light":
                    continue
                values = {str(parameter.getName()): _lighting_lab_value(parameter) for parameter in node.getParameters()}
                if os.path.basename(str(values.get("file", "")).replace("\\", "/")).lower() == asset["profile_name"].lower():
                    asset.update({"material": name, "mat_owned": name not in before, "readback": values,
                                  "loaded_names": loaded_names})
                    return asset
        except Exception:
            continue
    raise RuntimeError("KeyShot did not load the selected IES MTL as an in-project lux_ies_light material "
                       "(loadMaterials returned %s; new scene materials: %s)" %
                       (repr(loaded_result)[:180], ", ".join(sorted(set(lux.getSceneMaterials()) - before)[:12]) or "none"))


def _mesh_light_node(mname):
    return _light_graph_node(mname, "lux_mesh_light")


def _set_params(mname, spec, last=None, expected_type=None):
    """Set material parameters from spec; with `last` (dict of already-applied values) only the changed ones are written.
    Returns the list of parameter names actually written."""
    light_type = str(spec.get("type", "area")).lower()
    expected_type = expected_type or LIGHT_SHADER_NAMES.get(light_type, "lux_mesh_light")
    want = {}
    if light_type != "ies" and "power" in spec: want["power"] = float(spec["power"])
    if "kelvin" in spec or ("rgb" in spec and spec["rgb"] is not None):
        want["color"] = tuple(spec["rgb"]) if spec.get("rgb") is not None else kelvin_to_rgb(spec["kelvin"])
    if light_type == "area":
        if "visible_eye" in spec: want["visible to the eye"] = bool(spec["visible_eye"])
        if "visible_refl" in spec: want["visible in reflections"] = bool(spec["visible_refl"])
        if "visible_shadows" in spec: want["visible in shadows"] = bool(spec["visible_shadows"])
        if "samples" in spec: want["samples"] = int(spec["samples"])
    elif light_type in ("point", "spotlight"):
        if "radius" in spec: want["radius"] = float(spec["radius"])
        if light_type == "spotlight":
            if "angle" in spec: want["angle"] = float(spec["angle"])
            if "falloff" in spec: want["falloff"] = float(spec["falloff"])
            if "constant_output" in spec: want["focus_power_in_cone"] = bool(spec["constant_output"])
    elif light_type == "ies":
        if "multiplier" in spec: want["multiplier"] = float(spec["multiplier"])
        if "radius" in spec: want["radius"] = float(spec["radius"])
        if "axis" in spec: want["light axis"] = int(spec["axis"])
    if last is not None:
        want = {k: v for k, v in want.items() if last.get(k) != v}
    if not want:
        return []
    n = _light_graph_node(mname, expected_type)
    if n is None:
        raise RuntimeError("no %s node in material %s" % (expected_type, mname))
    parameters = {str(p.getName()): p for p in n.getParameters()}
    missing = sorted(set(want) - set(parameters))
    if missing:
        raise RuntimeError("%s light graph is missing required parameters: %s" % (light_type, ", ".join(missing)))
    done = []
    for name, value in want.items():
        parameters[name].setValue(value)
        done.append(name)
        if last is not None:
            last[name] = value
    return done


def _capture_light_parameters(mname, expected_type="lux_mesh_light"):
    node = _light_graph_node(mname, expected_type)
    if node is None:
        raise RuntimeError("no %s node in material %s" % (expected_type, mname))
    values = {}
    for parameter in node.getParameters():
        name = str(parameter.getName())
        value = _lighting_lab_value(parameter)
        if not isinstance(value, dict) and value is not None:
            values[name] = value
    return values


def _restore_light_parameters(mname, values, expected_type="lux_mesh_light"):
    node = _light_graph_node(mname, expected_type)
    if node is None:
        raise RuntimeError("no %s node in material %s" % (expected_type, mname))
    restored = set()
    for parameter in node.getParameters():
        name = str(parameter.getName())
        if name not in values:
            continue
        value = values[name]
        if isinstance(value, list):
            value = tuple(value)
        parameter.setValue(value)
        restored.add(name)
    missing = sorted(set(values) - restored)
    if missing:
        raise RuntimeError("light parameter rollback missed: %s" % ", ".join(missing[:8]))


def adopt_orphans():
    """Register lights that exist in the scene but not in REG (KeyShot's crash recovery restores our lights while the
    bridge's memory starts empty). Without this, rebuilding a rig would stack a second set on top of the old one."""
    adopted = []
    for n in _scene_nodes():
        nm = n.getName() or ""
        if not n.isObject() or not nm.startswith(PREFIX):
            continue
        lid = nm[len(PREFIX):]
        if lid in REG:
            continue
        try:
            mn = lux.getObjectMaterial(n.getID()); mn = mn[0] if isinstance(mn, (list, tuple)) else mn
        except Exception:
            mn = ""
        light_type = "area"
        for candidate_type, shader_name in LIGHT_SHADER_NAMES.items():
            try:
                if _light_graph_node(mn, shader_name) is not None:
                    light_type = candidate_type
                    break
            except Exception:
                continue
        REG[lid] = {"obj_id": n.getID(), "mat": mn, "adopted": True, "light_type": light_type,
                    "created_node_ids": [n.getID()],
                    "created_geometry_ids": [n.getID()] if n.getID() in set(lux.getObjects()) else [],
                    "mat_owned": False,
                    "spec": {"type": light_type, "size": [300, 300], "target": [0, 0, 0], "roll": 0.0, "power": 100.0, "kelvin": 5600,
                             "visible_refl": True, "visible_eye": False}}
        adopted.append(lid)
    if ENV_STATE["prev"] is None and lux.getActiveEnvironment().getName() == ENV_NAME:
        others = [e for e in lux.getEnvironments() if e != ENV_NAME]
        ENV_STATE["prev"] = "Animation" if "Animation" in others else (others[0] if others else None)
    return adopted


# ---- ops -------------------------------------------------------------------------------------
SET_WORDS = ("backdrop", "background", "backplate", "ground", "floor", "cyc", "sweep", "ramp", "plinth", "podium", "pedestal")


def op_subject(c):
    """Bounding box of the product: model nodes only; never our lights; set pieces (backdrop / floor / ramp ...) are
    left out when there is anything else in the scene, so a big backdrop does not become 'the product'."""
    # KeyShot 2026.2 can expose visible primitive/imported geometry as object nodes
    # without returning an enclosing model from find(types=NODE_TYPE_MODEL).
    # The renderer still sees these (and getObjects() reports their IDs), so include
    # those leaves as a fallback for product bounds and photo framing.
    try:
        geometry_ids = set(lux.getObjects())
    except Exception:
        geometry_ids = set()
    cands = []
    seen = set()
    try:
        nodes = lux.getSceneTree().find()
    except Exception:
        nodes = lux.getSceneTree().find(types=lux.NODE_TYPE_MODEL)
    for m in nodes:
        nm = m.getName() or ""
        if nm.startswith(PREFIX) or nm.lower().startswith("cc_light_panel"):
            continue                                   # never count our own lights as part of the product
        try:
            if not (m.isModel() or m.getID() in geometry_ids):
                continue
        except Exception:
            if m.getID() not in geometry_ids:
                continue
        try:
            if m.isDeleted() or m.isHidden():
                continue
        except Exception:
            pass
        if m.getID() in seen:
            continue
        seen.add(m.getID())
        cands.append((nm, m))
    product = [(n, m) for n, m in cands if not any(w in n.lower() for w in SET_WORDS)]
    use = product or cands                             # if everything looks like a set piece, use it all
    if not use:
        raise ValueError("No visible product model found. Open or show your product first.")
    lo = [1e9] * 3; hi = [-1e9] * 3; names = []
    for nm, m in use:
        bb = m.getBoundingBox(world=True)
        mn, mx = bb[0].val(), bb[1].val()
        names.append(nm)
        for i in range(3):
            lo[i] = min(lo[i], mn[i]); hi[i] = max(hi[i], mx[i])
    size = [hi[i] - lo[i] for i in range(3)]
    return {"models": names, "skipped_set_pieces": [n for n, _ in cands if (n, _) not in use][:10], "min": lo, "max": hi, "size": size,
            "center": [(hi[i] + lo[i]) / 2 for i in range(3)], "span": max(size)}


def op_light_set(c):
    """Create or update a tracked native Area, Point, IES, or Spotlight source."""
    lid = str(c["id"])
    if lid not in REG:
        adopt_orphans()
    spec = dict(REG[lid]["spec"]) if lid in REG else {"type": "area", "size": [300, 300], "target": [0, 0, 0], "roll": 0.0,
                                                      "power": 1200.0, "kelvin": 5600,
                                                      "visible_refl": True, "visible_eye": False}
    spec.update({k: v for k, v in c.items() if k not in ("op",)})
    light_type = str(spec.get("type", "area")).lower()
    if light_type not in LIGHT_SHADER_NAMES:
        raise ValueError("type must be area, point, ies, or spotlight")
    # New lights inherit an Area-oriented template, including 5600 K. That default
    # must not silently recolor an IES fixture whose MTL already carries its tint.
    if light_type == "ies" and lid not in REG and "rgb" not in c and "kelvin" not in c:
        spec.pop("kelvin", None)
    if light_type == "ies" and not spec.get("ies_asset_id"):
        raise ValueError("ies_asset_id is required for an IES light; choose one returned by lighting_ies_assets")
    spec["type"] = light_type
    if lid in REG and str(REG[lid].get("spec", {}).get("type", "area")).lower() != light_type:
        raise ValueError("A tracked light cannot change source type in place. Remove it and create a new light ID with the requested type.")
    if lid.startswith("research_"):
        scene = lux.getSceneInfo()
        if os.path.basename(str(scene.get("file", ""))).lower() != "plugintest.bip":
            raise RuntimeError("research_ light operations are restricted to PluginTest.bip")
        state = _lighting_render_state()
        tree = state.get("tree")
        forms = {"Sphere", "Torus", "Cube", "Rounded Cube", "Cylinder"}
        if not isinstance(tree, list) or not forms.issubset({item.get("name") for item in tree}):
            raise RuntimeError("the five-form research inventory is not intact")
        base_names = forms | {"Default", "lux_root"}
        owned_node_ids = set()
        owned_geometry_ids = set()
        for tracked_id, entry in REG.items():
            if not str(tracked_id).startswith(("research_", "lighting_")):
                raise RuntimeError("a non-research Director light is present; refusing a research light edit")
            owned_node_ids.update(str(value) for value in entry.get("created_node_ids", ()))
            owned_geometry_ids.update(str(value) for value in entry.get("created_geometry_ids", ()))
        live_geometry_ids = set(str(value) for value in lux.getObjects())
        owned_live_ids = {str(item.get("id")) for item in tree
                          if item.get("is_object") and str(item.get("id")) in owned_node_ids}
        owned_live_ids.update(owned_geometry_ids.intersection(live_geometry_ids))
        if int(scene.get("objects", -1)) != 5 + len(owned_live_ids):
            raise RuntimeError("scene objects do not match the five forms plus tracked research lights")
        unexpected = [item for item in tree
                      if item.get("name") not in base_names and str(item.get("id")) not in owned_node_ids]
        if unexpected:
            raise RuntimeError("unowned scene-tree items are present; refusing a research light edit")
    created = False
    if lid not in REG:
        node, created_node_ids, created_geometry_ids, units_before = _import_panel()
        materials_before = None
        ies_asset = None
        try:
            materials_before = set(lux.getSceneMaterials())
            node.setName(PREFIX + lid)
            parent = node.getParent()
            if parent.getID() in created_node_ids and parent.isGroup():
                parent.setName(PREFIX + lid + "_grp")
            if light_type == "ies":
                ies_asset = _load_ies_scene_material(spec["ies_asset_id"])
                mn = ies_asset["material"]
                lux.setObjectMaterial(mn, node.getID())
            else:
                lux.setObjectMaterial(spec.get("lib", LIGHT_LIBRARY_MATERIALS[light_type]), node.getID())
                mn = _material_name(lux.getObjectMaterial(node.getID()))
            if not mn or _light_graph_node(mn, LIGHT_SHADER_NAMES[light_type]) is None:
                raise RuntimeError("assigned material does not expose the expected %s graph" % LIGHT_SHADER_NAMES[light_type])
            materials_after = set(lux.getSceneMaterials())
            REG[lid] = {"obj_id": node.getID(), "mat": mn, "spec": spec,
                        "created_node_ids": created_node_ids,
                        "created_geometry_ids": created_geometry_ids,
                        "mat_owned": bool(ies_asset["mat_owned"] if ies_asset else mn not in materials_before and mn in materials_after),
                        "light_type": light_type,
                        "ies_profile": ies_asset,
                        "scene_unit": units_before}
            created = True
        except Exception as exc:
            # Import can succeed while material assignment or naming fails. Keep
            # ownership precise and remove only IDs created by this operation.
            cleanup = _delete_created_nodes(created_node_ids, created_geometry_ids)
            if not cleanup["remaining_nodes"] and not cleanup["remaining_geometry"] and not cleanup["errors"]:
                if materials_before is not None:
                    for material in set(lux.getSceneMaterials()) - materials_before:
                        try: _delete_unused_material(material)
                        except Exception: pass
            else:
                # Retain a repair handle if KeyShot refuses to remove an imported node.
                REG[lid] = {"obj_id": node.getID(), "mat": "", "spec": spec,
                            "created_node_ids": created_node_ids,
                            "created_geometry_ids": created_geometry_ids,
                            "mat_owned": False, "scene_unit": units_before}
            raise RuntimeError("could not finish creating Director light %s: %s%s" %
                               (lid, str(exc)[:180],
                                ("; rollback incomplete: " + str(cleanup)) if cleanup["remaining_nodes"] or cleanup["remaining_geometry"] or cleanup["errors"] else ""))
    ent = REG[lid]
    prior_spec = dict(ent.get("spec", {}))
    old_applied = dict(ent.get("applied", {"xf": None, "params": {}}))
    old_applied["params"] = dict(old_applied.get("params", {}))
    prior_transform = None
    prior_parameters = None
    try:
        node = _light_node(ent["obj_id"], lid)
        if node is None:
            raise RuntimeError("light node for %s vanished" % lid)
        prior_transform = luxmath.Matrix(node.getTransform(world=True).val())
        prior_parameters = _capture_light_parameters(ent["mat"], LIGHT_SHADER_NAMES[light_type])
        pos = tuple(round(float(x), 4) for x in spec["pos"]); tgt = tuple(round(float(x), 4) for x in spec["target"])
        source_size = spec.get("size", [300, 300]) if light_type == "area" else [10.0, 10.0]
        size = (round(float(source_size[0]), 4), round(float(source_size[1]), 4))
        roll = round(float(spec.get("roll", 0.0)), 4)
        # Every KeyShot setter costs real time, so only touch what changed since the last call.
        applied = ent.setdefault("applied", {"xf": None, "params": {}})
        xf = (light_type, pos, tgt, size, roll)
        d = _norm(_sub(tgt, pos)); err = None; moved = False
        if applied["xf"] != xf:
            if light_type in ("spotlight", "ies"):
                M, d, roll_total = spotlight_matrix(pos, tgt, roll)
            else:
                M, d, roll_total = panel_matrix(pos, tgt, size, roll)
            node.applyTransform(M, absolute=True)
            applied["xf"] = xf; moved = True
            if light_type == "area":
                bb = node.getBoundingBox(world=True)             # self-check against independently computed corners
                got_lo, got_hi = bb[0].val(), bb[1].val()
                exp_lo, exp_hi = expected_bbox(pos, tgt, size, roll_total, d)
                err = round(max(max(abs(got_lo[i] - exp_lo[i]), abs(got_hi[i] - exp_hi[i])) for i in range(3)), 3)
        changed = _set_params(ent["mat"], spec, applied["params"], LIGHT_SHADER_NAMES[light_type])
        if moved or changed:
            lux.sync()
        ent["spec"] = spec
        readback = _capture_light_parameters(ent["mat"], LIGHT_SHADER_NAMES[light_type])
        return {"id": lid, "created": created, "material": ent["mat"], "placement_err_mm": err, "moved": moved,
                "type": light_type, "shader_type": LIGHT_SHADER_NAMES[light_type],
                "ies_asset_id": spec.get("ies_asset_id") if light_type == "ies" else None,
                "ies_profile": ent.get("ies_profile", {}).get("profile_name") if light_type == "ies" else None,
                "profile_native_color": ent.get("ies_profile", {}).get("readback", {}).get("color") if light_type == "ies" else None,
                "params_changed": changed, "readback": readback, "dir": [round(x, 4) for x in d],
                "aim_direction_world": [round(x, 4) for x in d],
                "spotlight_local_minus_y_world": [round(x, 4) for x in d] if light_type == "spotlight" else None,
                "orientation": "Spotlight local -Y emission axis is aimed at the target." if light_type == "spotlight" else "IES carrier uses the Spotlight local -Y aim; all six axis enum values were tested, but no universal best orientation was established. Preserve the profile default unless a scene-specific test supports changing it." if light_type == "ies" else "Light position targets the scene; carrier orientation is not a directional control." if light_type == "point" else "Area panel normal faces the target."}
    except Exception as exc:
        if created:
            try:
                removed = op_light_remove({"id": lid})
                if not removed.get("removed"):
                    raise RuntimeError("new light was not present for cleanup")
            except Exception as cleanup_error:
                raise RuntimeError("light %s setup failed (%s); rollback failed (%s)" %
                                   (lid, str(exc)[:160], str(cleanup_error)[:220]))
        else:
            # Updates also roll back to the last committed Director recipe.
            try:
                node = _light_node(ent["obj_id"], lid)
                if node is None or prior_transform is None or prior_parameters is None:
                    raise RuntimeError("light state snapshot is incomplete")
                node.applyTransform(prior_transform, absolute=True)
                _restore_light_parameters(ent["mat"], prior_parameters, LIGHT_SHADER_NAMES[light_type])
                lux.sync()
                ent["spec"] = prior_spec
                ent["applied"] = old_applied
            except Exception as rollback_error:
                raise RuntimeError("light %s update failed (%s); previous state could not be restored (%s)" %
                                   (lid, str(exc)[:160], str(rollback_error)[:220]))
        raise


def op_lighting_point_spot_probe(c):
    """Create one tracked Point/Spotlight on imported test geometry for a disposable-scene render probe."""
    unknown = set(c) - {"op", "id", "type", "pos", "target", "power", "radius", "angle", "falloff", "constant_output"}
    if unknown:
        raise ValueError("unsupported light probe input: %s" % sorted(unknown)[0])
    light_id = str(c.get("id", ""))
    if not light_id.startswith(("research_", "lighting_")) or len(light_id) > 48:
        raise ValueError("probe id must start with research_ or lighting_ and be no longer than 48 characters")
    if light_id in REG:
        raise ValueError("probe id already exists; restore the saved checkpoint before creating another light")
    light_type = str(c.get("type", "")).lower()
    materials = {"point": ("Point Light 1200 Lumen White", "lux_point_light"),
                 "spotlight": ("Spotlight 45 degrees 1200 Lumen Neutral", "lux_spotlight")}
    if light_type not in materials:
        raise ValueError("type must be point or spotlight")
    material_library_name, expected_shader = materials[light_type]
    pos = tuple(float(x) for x in c.get("pos", ()))
    target = tuple(float(x) for x in c.get("target", ()))
    if len(pos) != 3 or len(target) != 3 or _len(_sub(target, pos)) < 1e-4:
        raise ValueError("pos and target must be distinct 3D points in millimeters")
    power = float(c.get("power", 60000.0))
    radius = float(c.get("radius", 0.0))
    angle = float(c.get("angle", 45.0))
    falloff = float(c.get("falloff", 0.5))
    constant_output = bool(c.get("constant_output", True))
    if not (0.1 <= power <= 10000000.0 and 0.0 <= radius <= 10000.0):
        raise ValueError("power or radius is outside the supported probe range")
    if light_type == "spotlight" and not (1.0 <= angle <= 120.0 and 0.0 <= falloff <= 1.0):
        raise ValueError("spotlight angle must be 1..120 degrees and falloff 0..1")
    if not os.path.isfile(PANEL_OBJ):
        raise RuntimeError("The tracked test light carrier geometry is missing")

    node, created_node_ids, created_geometry_ids, units_before = _import_panel()
    entry = {"obj_id": node.getID(), "mat": "", "spec": dict(c),
             "created_node_ids": created_node_ids, "created_geometry_ids": created_geometry_ids,
             "mat_owned": False, "scene_unit": units_before, "probe_type": light_type}
    REG[light_id] = entry  # persist exact ownership before any material/transform operation can fail
    node.setName(PREFIX + light_id)
    parent = node.getParent()
    if parent is not None and str(parent.getID()) in set(str(value) for value in created_node_ids) and parent.isGroup():
        parent.setName(PREFIX + light_id + "_grp")
    if light_type == "spotlight":
        transform, direction, roll_total = spotlight_matrix(pos, target, 0.0)
    else:
        transform, direction, roll_total = panel_matrix(pos, target, (10.0, 10.0), 0.0)
    node.applyTransform(transform, absolute=True)
    materials_before = set(lux.getSceneMaterials())
    lux.setObjectMaterial(material_library_name, node.getID())
    material_name = _material_name(lux.getObjectMaterial(node.getID()))
    if not material_name:
        raise RuntimeError("KeyShot did not return the assigned light material name")
    entry["mat"] = material_name
    entry["mat_owned"] = material_name not in materials_before

    graph = lux.getMaterialGraph(material_name)
    shader_node = None
    for candidate in graph.getNodes():
        kind = candidate.getType()
        kind_name = str(kind.get("name", "")) if isinstance(kind, dict) else str(kind)
        if kind_name == expected_shader:
            shader_node = candidate
            break
    if shader_node is None:
        raise RuntimeError("Assigned material has no expected %s shader node" % expected_shader)

    # Use neutral white for a controlled light-type probe. Color temperature is
    # a separate stylistic control and must not contaminate the source comparison.
    wanted = {"power": power, "color": (1.0, 1.0, 1.0), "radius": radius}
    if light_type == "spotlight":
        wanted.update({"angle": angle, "falloff": falloff, "focus_power_in_cone": constant_output})
    found = set()
    readback = {}
    for parameter in shader_node.getParameters():
        name = str(parameter.getName())
        if name in wanted:
            parameter.setValue(wanted[name])
            found.add(name)
        readback[name] = _lighting_lab_value(parameter)
    required = {"power", "color", "radius"} | ({"angle", "falloff", "focus_power_in_cone"} if light_type == "spotlight" else set())
    missing = sorted(required - found)
    if missing:
        raise RuntimeError("Light graph is missing required parameters: %s" % ", ".join(missing))
    lux.sync()
    entry["spec"] = dict(c)
    return {"schema_version": "1.0", "id": light_id, "type": light_type,
            "created": True, "material": material_name, "shader_type": expected_shader,
            "pos_mm": list(pos), "target_mm": list(target),
            ("aim_direction_local_minus_y" if light_type == "spotlight" else "aim_direction_local_z"): [round(float(x), 6) for x in direction],
            "carrier_node_ids": [str(value) for value in created_node_ids],
            "carrier_geometry_ids": [str(value) for value in created_geometry_ids],
            "readback": readback,
            "orientation": ("Spotlight local -Y emission axis was confirmed by a controlled render on KeyShot Studio 2026.2." if light_type == "spotlight" else "Point emission is position-driven; carrier orientation does not affect the light.")}


def op_light_remove(c):
    lid = str(c["id"])
    if lid not in REG:
        adopt_orphans()  # recover a panel if creation failed after import but before registration
    ent = REG.get(lid)
    if not ent:
        return {"removed": False}
    node = _light_node(ent["obj_id"], lid)
    node_ids = set(ent.get("created_node_ids", ()))
    geometry_ids = set(ent.get("created_geometry_ids", ()))
    if not node_ids:
        node_ids.add(ent["obj_id"])
    if node is not None:
        node_ids.add(node.getID())
        # Only include the parent if this light created and still owns that group.
        parent = node.getParent()
        children = [] if parent.isObject() else [child for child in parent.getChildren() if not child.isDeleted()]
        if parent.isGroup() and parent.getName() == PREFIX + lid + "_grp" and all(child.getID() == node.getID() for child in children):
            node_ids.add(parent.getID())
        if node.getID() in set(lux.getObjects()):
            geometry_ids.add(node.getID())
    # KeyShot 2026.2 can retain a mesh ID after its SceneNode has been deleted.
    # Its documented clearGeometry() removes every scene object, so never use it
    # as a fallback for one light. Stop before touching anything outside the
    # retained owner record and require a clean disposable-scene reload instead.
    if node is None and geometry_ids.intersection(set(lux.getObjects())):
        raise RuntimeError("Director light %s has retained geometry without a live SceneNode; refusing broad scene cleanup. Reopen the disposable scene without saving to remove this failed probe." % lid)
    cleanup = _delete_created_nodes(node_ids, geometry_ids)
    if cleanup["remaining_nodes"] or cleanup["remaining_geometry"] or cleanup["errors"]:
        raise RuntimeError("Director light %s cleanup is incomplete; retained ownership for retry: %s" %
                           (lid, cleanup))

    material_removed = False
    if ent.get("mat_owned"):
        material = ent.get("mat", "")
        if _material_in_use(material):
            # A later scene edit linked this material elsewhere; leave it in place.
            ent["mat_owned"] = False
        else:
            material_removed = _delete_unused_material(material)
            if not material_removed and material in lux.getSceneMaterials():
                raise RuntimeError("Director light %s geometry is gone, but its owned material could not be removed; retained ownership for retry" % lid)
    REG.pop(lid, None)
    return {"removed": True, "material_removed": material_removed,
            "scene_unit": _scene_unit_snapshot(), "remaining_owned_geometry": cleanup["remaining_geometry"]}


def op_lights_clear(c):
    adopt_orphans()
    ids = list(REG.keys())
    for lid in ids:
        op_light_remove({"id": lid})
    return {"cleared": ids}


def op_lights_list(c):
    adopt_orphans()
    out = {}
    for lid, ent in REG.items():
        node = _light_node(ent["obj_id"], lid)
        spec = ent.get("spec", {})
        light_type = spec.get("type", "area")
        try:
            readback = _capture_light_parameters(ent["mat"], LIGHT_SHADER_NAMES[light_type])
        except Exception as exc:
            readback = {"read_error": str(exc)[:160]}
        native_color = ent.get("ies_profile", {}).get("readback", {}).get("color") if light_type == "ies" else None
        out[lid] = {"spec": spec, "material": ent["mat"], "readback": readback,
                    "profile_native_color": native_color,
                    "adopted": bool(ent.get("adopted")),
                    "hidden": bool(node.isHidden()) if node is not None else True}
    return out


def op_light_visibility(c):
    adopt_orphans()
    changed = []
    for lid in c.get("ids", []):
        if lid not in REG:
            continue
        node = _light_node(REG[lid]["obj_id"], lid)
        if node is not None:
            if c.get("visible", True): node.show()
            else: node.hide()
            changed.append(lid)
    lux.sync()
    return {"changed": changed}


def op_env_set(c):
    """Switch to our own environment (cloned from the current one the first time) and set it up.
    keys: hdri (path relative to Environments/ or absolute), brightness, rotation, bg [r,g,b 0..255],
    ground_shadows, ground_reflections, size, height."""
    if ENV_STATE["prev"] is None:
        cur = lux.getActiveEnvironment().getName()
        if cur != ENV_NAME:
            ENV_STATE["prev"] = cur
        else:                                # our environment is already active (restored session): infer the original
            adopt_orphans()
            if ENV_STATE["prev"] is None:
                ENV_STATE["prev"] = "Animation"
    env_name = c.get("director_name", ENV_NAME)
    if env_name != ENV_NAME and not (str(env_name).startswith("CC_Photo_") and len(str(env_name)) < 80):
        raise ValueError("Invalid Director environment name")
    if env_name not in lux.getEnvironments():
        lux.newEnvironment(env_name, activate=True, clone=True)
    else:
        lux.setActiveEnvironment(env_name)
    e = lux.getActiveEnvironment()
    if c.get("hdri"):
        h = c["hdri"]
        e.setLightingEnvironment(h if (":" in h) else ENV_DIR + h)
    if "bg" in c and c["bg"] is not None: e.setBackgroundColor(tuple(int(v) for v in c["bg"]))
    if "brightness" in c: e.setBrightness(max(0.000001, float(c["brightness"])))
    if "rotation" in c: e.setRotation(float(c["rotation"]) % 360.0)
    if "ground_shadows" in c: e.setGroundShadows(bool(c["ground_shadows"]))
    if "ground_reflections" in c: e.setGroundReflections(bool(c["ground_reflections"]))
    if "size" in c: e.setSize(float(c["size"]))
    if "height" in c: e.setHeight(float(c["height"]))
    lux.sync()
    return {"env": e.getName(), "brightness": e.getBrightness(), "rotation": e.getRotation(),
            "bg": e.getBackgroundColor(), "hdri": str(e.getLightingEnvironment()), "prev": ENV_STATE["prev"]}


def op_studio_off(c):
    """Remove every light we made and put the user's original environment back."""
    cleared = op_lights_clear({})["cleared"]
    prev = ENV_STATE["prev"]
    if prev and prev in lux.getEnvironments():
        lux.setActiveEnvironment(prev)
    if ENV_NAME in lux.getEnvironments():
        try: lux.removeEnvironment(ENV_NAME)
        except Exception: pass
    ENV_STATE["prev"] = None
    lux.sync()
    return {"cleared": cleared, "env": lux.getActiveEnvironment().getName()}


def op_image_style(c):
    s = lux.getActiveImageStyle()
    done = {}
    for key, fn in (("bloom", "setBloom"), ("vignette", "setVignette"), ("denoise", "setDenoise")):
        if key in c:
            getattr(s, fn)(bool(c[key])); done[key] = bool(c[key])
    return {"style": s.getName(), "applied": done}


def op_env_info(c):
    e = lux.getActiveEnvironment()
    info = {"name": e.getName(), "hdri": str(e.getLightingEnvironment()),
            "brightness": e.getBrightness(), "rotation": e.getRotation(), "bg": list(e.getBackgroundColor())}
    for key, method in (("ground_shadows", "getGroundShadows"), ("ground_reflections", "getGroundReflections"),
                        ("size", "getSize"), ("height", "getHeight")):
        if hasattr(e, method):
            try: info[key] = getattr(e, method)()
            except Exception: pass
    return info


def op_env_restore(c):
    # Select the original environment without removing any user environment.
    info = c["snapshot"]
    if info["name"] not in lux.getEnvironments():
        raise ValueError("Original environment is no longer in the scene")
    lux.setActiveEnvironment(info["name"])
    if c.get("select_only"):
        lux.sync()
        return op_env_info({})
    e = lux.getActiveEnvironment()
    for key, method in (("hdri", "setLightingEnvironment"), ("brightness", "setBrightness"),
                        ("rotation", "setRotation"), ("bg", "setBackgroundColor"),
                        ("ground_shadows", "setGroundShadows"), ("ground_reflections", "setGroundReflections"),
                        ("size", "setSize"), ("height", "setHeight")):
        if key in info and hasattr(e, method):
            value = info[key]
            if key in ("brightness", "rotation", "size", "height"): value = float(value)
            if key == "brightness": value = max(0.000001, value)
            if key == "bg": value = tuple(int(v) for v in value)
            getattr(e, method)(value)
    lux.sync()
    return op_env_info({})


LIGHT_SHADER_TYPES = {
    "area": "lux_mesh_light",
    "point": "lux_point_light",
    "ies": "lux_ies_light",
    "spotlight": "lux_spotlight",
}
LIGHT_MATERIAL_TOKENS = {
    "area": ("area light", "arealight"),
    "point": ("point light", "pointlight"),
    "ies": ("ies", "photometric"),
    "spotlight": ("spotlight", "spot light"),
}


def _lighting_lab_material_match(category, name):
    low = name.lower()
    if category == "ies":
        import re
        return "photometric" in low or re.search(r"(?<![a-z0-9])ies(?![a-z0-9])", low) is not None
    return any(token in low for token in LIGHT_MATERIAL_TOKENS[category])


def _ies_photometry_metadata(profile_path):
    """Parse common LM-63 TILT=NONE profiles into compact read-only lighting evidence."""
    import math
    import re

    base = {"source": "LM-63 IES profile"}
    try:
        if not profile_path or not os.path.isfile(profile_path):
            return dict(base, status="missing_profile")
        if os.path.getsize(profile_path) > 32 * 1024 * 1024:
            return dict(base, status="unsupported", reason="profile exceeds the 32 MiB scan limit")
        with open(profile_path, "r", encoding="ascii", errors="replace") as source:
            content = source.read()
        header = content.splitlines()[0].strip() if content.splitlines() else ""
        tilt = re.search(r"(?im)^\s*TILT\s*=\s*([^\r\n]+)", content)
        if not tilt:
            return dict(base, status="invalid", format=header, reason="TILT record not found")
        tilt_mode = tilt.group(1).strip().upper()
        if tilt_mode != "NONE":
            return dict(base, status="unsupported", format=header, tilt_mode=tilt_mode,
                        reason="only TILT=NONE profiles are parsed")

        numeric_text = re.sub(r"![^\r\n]*", " ", content[tilt.end():])
        pattern = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?"
        values = [float(token) for token in re.findall(pattern, numeric_text)]
        if len(values) < 13 or any(not math.isfinite(value) for value in values[:13]):
            return dict(base, status="invalid", format=header, tilt_mode=tilt_mode,
                        reason="photometric header is incomplete or non-finite")

        lamps, lumens_per_lamp, candela_scale = int(round(values[0])), values[1], values[2]
        vertical_count, horizontal_count = int(round(values[3])), int(round(values[4]))
        photo_type, units_type = int(round(values[5])), int(round(values[6]))
        ballast, watts = values[10], values[12]
        table_count = vertical_count + horizontal_count + vertical_count * horizontal_count
        if (lamps < 0 or vertical_count < 1 or horizontal_count < 1 or vertical_count > 10000 or
                horizontal_count > 10000 or vertical_count * horizontal_count > 5000000 or
                len(values) < 13 + table_count):
            return dict(base, status="invalid", format=header, tilt_mode=tilt_mode,
                        reason="angle counts or candela table dimensions are invalid")

        i = 13
        vertical = values[i:i + vertical_count]
        i += vertical_count
        horizontal = values[i:i + horizontal_count]
        i += horizontal_count
        candela = values[i:i + vertical_count * horizontal_count]
        if any(not math.isfinite(value) for value in vertical + horizontal + candela):
            return dict(base, status="invalid", format=header, tilt_mode=tilt_mode,
                        reason="photometric distribution contains non-finite samples")

        widths_50, widths_10 = [], []
        peak_cd, peak_v, peak_h = -1.0, None, None
        for plane in range(horizontal_count):
            row = [value * candela_scale * ballast for value in candela[plane * vertical_count:(plane + 1) * vertical_count]]
            row_peak = max(row)
            if row_peak > 0:
                peak_index = row.index(row_peak)
                for threshold, bucket in ((0.5, widths_50), (0.1, widths_10)):
                    left = right = peak_index
                    while left > 0 and row[left - 1] >= row_peak * threshold:
                        left -= 1
                    while right + 1 < len(row) and row[right + 1] >= row_peak * threshold:
                        right += 1
                    bucket.append(vertical[right] - vertical[left])
            if row_peak > peak_cd:
                peak_cd = row_peak
                peak_v = vertical[row.index(row_peak)]
                peak_h = horizontal[plane]

        def median(items):
            if not items:
                return None
            ordered = sorted(items)
            middle = len(ordered) // 2
            return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2.0

        lumens = lamps * lumens_per_lamp if lamps > 0 and lumens_per_lamp > 0 else None
        return {
            "status": "parsed", "source": "LM-63 IES profile", "format": header, "tilt_mode": tilt_mode,
            "photometric_type_code": photo_type, "photometric_type": {1: "C", 2: "B", 3: "A"}.get(photo_type),
            "units_type_code": units_type, "dimension_unit": {1: "feet", 2: "meters"}.get(units_type),
            "lamps": lamps, "lumens_per_lamp": round(lumens_per_lamp, 3) if lumens_per_lamp > 0 else None,
            "photometric_lumens": round(lumens, 1) if lumens is not None else None,
            "lumen_reference_mode": "lamp_lumen_rating" if lumens is not None else "absolute_candela_or_unavailable",
            "input_watts": round(watts, 3) if watts > 0 else None,
            "candela_multiplier": round(candela_scale, 6), "ballast_factor": round(ballast, 6),
            "peak_candela": round(peak_cd, 3) if peak_cd >= 0 else None,
            "peak_vertical_angle_deg": round(peak_v, 3) if peak_v is not None else None,
            "peak_horizontal_angle_deg": round(peak_h, 3) if peak_h is not None else None,
            "median_dominant_lobe_width_at_50_percent_peak_deg": round(median(widths_50), 3) if widths_50 else None,
            "median_dominant_lobe_width_at_10_percent_peak_deg": round(median(widths_10), 3) if widths_10 else None,
            "vertical_angle_samples": vertical_count, "horizontal_angle_samples": horizontal_count,
            "horizontal_angle_range_deg": [round(min(horizontal), 3), round(max(horizontal), 3)],
            "distribution_note": "Widths follow the contiguous dominant vertical lobe in each horizontal plane; they are not guaranteed to match the vendor beam-angle label or describe secondary lobes."
        }
    except Exception as error:
        return dict(base, status="invalid", reason=str(error)[:180])


def _lighting_ies_file_assets(limit=40):
    """Find installed IES material/profile pairs without importing or changing the scene."""
    import re
    material_root = os.path.abspath(lux.getKeyShotFolder(lux.FOLDER_MATERIALS))
    ies_root = os.path.join(material_root, "Light", "IES Light")
    profile_root = os.path.join(os.path.dirname(material_root), "Textures", "IES Profiles")
    if not os.path.isdir(ies_root):
        return {"material_root": material_root, "profile_root": profile_root, "assets": [],
                "error": "The KeyShot user-library IES Light folder was not found."}
    files = []
    visited = 0
    for directory, subdirs, names in os.walk(ies_root):
        subdirs.sort(key=str.lower)
        for filename in sorted(names, key=str.lower):
            if not filename.lower().endswith(".mtl"):
                continue
            visited += 1
            if visited > 50000:
                break
            files.append(os.path.join(directory, filename))
        if visited > 50000 or len(files) >= max(500, limit * 12):
            break

    assets = []
    for full_path in sorted(files, key=str.lower):
        try:
            if os.path.getsize(full_path) > 8 * 1024 * 1024:
                continue
            with open(full_path, "r", encoding="utf-8", errors="replace") as source:
                content = source.read()
            if "lux_ies_light" not in content:
                continue
            match = re.search(r'"file"\s+"([^"]+)"', content)
            if not match:
                continue
            profile_name = os.path.basename(match.group(1).replace("\\", "/"))
            relative_from_ies = os.path.relpath(os.path.dirname(full_path), ies_root)
            profile_path = os.path.join(profile_root, relative_from_ies, profile_name)
            if not os.path.isfile(profile_path):
                profile_path = ""
                # Some vendors store the matching IES profile under a slightly
                # different category capitalization or folder. Match by basename.
                for profile_dir, profile_subdirs, profile_files in os.walk(profile_root):
                    profile_subdirs.sort(key=str.lower)
                    if profile_name.lower() in {name.lower() for name in profile_files}:
                        profile_path = os.path.join(profile_dir, profile_name)
                        break
            name_hint = os.path.splitext(os.path.basename(full_path))[0]
            encoded = re.search(r"^#define\s+material\s+xX([0-9a-fA-F]+)", content, re.M)
            if encoded:
                try:
                    name_hint = bytes.fromhex(encoded.group(1)).decode("utf-8", errors="replace")
                except Exception:
                    pass
            kelvin_match = re.search(r"(?<!\d)(\d{4})\s*K\b", name_hint, re.I)
            rel = os.path.relpath(full_path, material_root).replace("\\", "/")
            assets.append({"asset_id": rel, "material_name_hint": name_hint,
                           "shader_type": "lux_ies_light", "profile": profile_name,
                           "profile_kelvin_hint": int(kelvin_match.group(1)) if kelvin_match else None,
                           "profile_exists": bool(profile_path),
                           "profile_relative_path": os.path.relpath(profile_path, profile_root).replace("\\", "/") if profile_path else None,
                           "photometry": _ies_photometry_metadata(profile_path),
                           "parameter_names": sorted(set(re.findall(r'^\"([^\"]+)\"\s+', content, re.M))),
                           "source": "installed IES .mtl and .ies file"})
            if len(assets) >= limit:
                break
        except Exception:
            continue
    return {"material_root": material_root, "profile_root": profile_root,
            "assets": assets, "files_scanned": len(files), "truncated": len(files) >= max(500, limit * 12)}


def _lighting_lab_type(node):
    try:
        value = node.getType()
        if isinstance(value, dict):
            return str(value.get("name") or value.get("display_name") or value)
        return str(value)
    except Exception:
        return ""


def _lighting_lab_value(parameter):
    try:
        if hasattr(parameter, "isPure") and parameter.isPure():
            return None
        value = parameter.getValue()
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        if isinstance(value, (tuple, list)):
            return list(value)
        if hasattr(value, "val"):
            try:
                return list(value.val())
            except Exception:
                pass
        return str(value)
    except Exception as exc:
        return {"read_error": str(exc)[:160]}


def op_lighting_control_surface(c):
    """Read lighting-related lux API names and type metadata without loading libraries or touching the scene."""
    import sys
    type_names = ("Env", "Studio", "MaterialGraph", "ShaderNode", "ShaderParameter", "SceneNode", "RenderOptions")
    type_surfaces = {}
    for class_name in type_names:
        try:
            cls = getattr(lux, class_name, None)
            if cls is None:
                continue
            type_surfaces[class_name] = {
                "doc": str(getattr(cls, "__doc__", "") or "")[:1200],
                "methods": sorted(name for name in dir(cls) if not name.startswith("_")),
            }
        except Exception as exc:
            type_surfaces[class_name] = {"read_error": str(exc)[:160]}

    tokens = ("light", "environment", "pin", "hdri", "ies", "renderpass", "render_pass", "material", "graph",
              "target", "pick", "ray", "intersect", "project", "surface", "normal")
    names = sorted(name for name in dir(lux) if any(token in name.lower() for token in tokens))
    surface_tokens = ("target", "pick", "ray", "intersect", "project", "surface", "normal", "boundingbox", "bounds")
    surface_names = sorted(name for name in dir(lux) if any(token in name.lower() for token in surface_tokens))
    doc_names = ("getActiveEnvironment", "getLibraryEnvironments", "getLightingPreset", "getLightingPresets",
                 "setLightingPreset", "getMaterialGraph", "createSceneMaterial", "importFile", "clearGeometry",
                 "getRenderEngine", "setRenderEngine")
    docs = {}
    for name in doc_names:
        try:
            doc = getattr(getattr(lux, name, None), "__doc__", None)
            if doc:
                docs[name] = str(doc)[:1200]
        except Exception:
            pass

    constants = sorted(name for name in dir(lux) if name.startswith(("SHADER_TYPE_", "LIGHT_", "RENDER_PASS_", "RENDER_ENGINE_")))
    def safe_call(name):
        try:
            fn = getattr(lux, name, None)
            return fn() if callable(fn) else None
        except Exception as exc:
            return {"read_error": str(exc)[:160]}

    return {
        "schema_version": "1.0",
        "read_only": True,
        "keyshot": {
            "display_version": safe_call("getKeyShotDisplayVersion"),
            "version": safe_call("getKeyShotVersion"),
            "python": sys.version.split()[0],
            "render_engine": safe_call("getRenderEngine"),
        },
        "api_surface": {
            "lighting_related_lux_names": names,
            "potential_pin_names": [name for name in names if "pin" in name.lower() or "hdri" in name.lower()],
            "surface_targeting_names": surface_names,
            "constants": {name: str(getattr(lux, name)) for name in constants},
            "function_docs": docs,
            "type_surfaces": type_surfaces,
        },
        "inspection_scope": "Runtime names and type metadata only; no scene reads, resource-library loads, renders, or mutations.",
    }


def op_lighting_inspect(c):
    """Read the installed KeyShot light-material graphs and their exposed parameters; never edits the scene."""
    requested = c.get("types", list(LIGHT_SHADER_TYPES.keys()))
    if not isinstance(requested, (list, tuple)) or not requested:
        raise ValueError("types must be a non-empty list of area, point, ies, or spotlight")
    requested = list(dict.fromkeys(str(x).lower() for x in requested))
    if len(requested) > len(LIGHT_SHADER_TYPES) or any(x not in LIGHT_SHADER_TYPES for x in requested):
        raise ValueError("types may contain only area, point, ies, and spotlight")
    try:
        max_assets = int(c.get("max_assets", 12))
    except (TypeError, ValueError):
        raise ValueError("max_assets must be an integer from 1 to 40")
    if max_assets < 1 or max_assets > 40:
        raise ValueError("max_assets must be an integer from 1 to 40")

    import sys
    def safe_call(fn_name):
        try:
            fn = getattr(lux, fn_name, None)
            return fn() if callable(fn) else None
        except Exception as exc:
            return {"read_error": str(exc)[:160]}

    api_docs = {}
    for name in ("getMaterialTemplates", "setMaterialTemplate", "createSceneMaterial", "getMaterialGraph", "getLibraryMaterials", "deleteMaterial"):
        try:
            doc = getattr(getattr(lux, name, None), "__doc__", None)
            if doc:
                api_docs[name] = str(doc)[:1200]
        except Exception:
            pass
    type_surfaces = {}
    for class_name in ("MaterialGraph", "ShaderNode", "ShaderParameter", "SceneNode"):
        try:
            cls = getattr(lux, class_name, None)
            if cls is None:
                continue
            type_surfaces[class_name] = {
                "doc": str(getattr(cls, "__doc__", "") or "")[:1200],
                "methods": sorted(name for name in dir(cls) if not name.startswith("_")),
            }
        except Exception:
            pass

    names = sorted(set(str(x) for x in lux.getLibraryMaterials() if x))
    api_names = dir(lux)
    template_value = safe_call("getMaterialTemplates")
    template_error = template_value.get("read_error") if isinstance(template_value, dict) else None
    if template_error:
        template_names = []
    elif isinstance(template_value, dict):
        template_names = sorted(str(x) for x in template_value.keys())
    elif isinstance(template_value, (list, tuple, set)):
        template_names = sorted(str(x) for x in template_value)
    elif template_value is None:
        template_names = []
    else:
        template_names = [str(template_value)[:240]]
    related_templates = [name for name in template_names if any(word in name.lower() for word in ("light", "photometric", "fixture", "spot", "point", "area"))]
    import re
    related_templates.extend(name for name in template_names if re.search(r"(?<![a-z0-9])ies(?![a-z0-9])", name.lower()) and name not in related_templates)
    output = {
        "schema_version": "1.0",
        "read_only": True,
        "keyshot": {
            "display_version": safe_call("getKeyShotDisplayVersion"),
            "version": safe_call("getKeyShotVersion"),
            "python": sys.version.split()[0],
        },
        "api_surface": {
            "lux_lighting_methods": sorted(x for x in dir(lux) if any(k in x.lower() for k in ("light", "environment", "renderpass", "render_pass"))),
            "lux_graph_material_methods": sorted(x for x in api_names if any(k in x.lower() for k in ("material", "shader", "graph")))[:250],
            "lux_scene_geometry_methods": sorted(x for x in api_names if any(k in x.lower() for k in ("scene", "object", "node", "geometry", "mesh", "import")))[:250],
            "light_shader_constants": {name: str(getattr(lux, name)) for name in ("SHADER_TYPE_MESH_LIGHT", "SHADER_TYPE_POINT_LIGHT", "SHADER_TYPE_IES_LIGHT", "SHADER_TYPE_SPOTLIGHT") if hasattr(lux, name)},
            "folder_constants": sorted(x for x in api_names if x.startswith("FOLDER_")),
            "material_api_docs": api_docs,
            "type_surfaces": type_surfaces,
            "render_options_methods": sorted(x for x in dir(getattr(lux, "RenderOptions", object)) if not x.startswith("_")),
        },
        "requested_types": requested,
        "library_material_count": len(names),
        "material_templates": {"count": len(template_names), "light_related": related_templates[:100], "sample": template_names[:40],
                               "read_error": template_error},
        "lights": {},
    }
    for category in requested:
        shader_type = LIGHT_SHADER_TYPES[category]
        candidates = [name for name in names if _lighting_lab_material_match(category, name)]
        matches = []
        errors = []
        unmatched = []
        for name in candidates[:max_assets]:
            try:
                graph = lux.getMaterialGraph(name)
                observed = []
                for node in graph.getNodes():
                    node_type = _lighting_lab_type(node)
                    if node_type:
                        observed.append(node_type)
                    if node_type != shader_type:
                        continue
                    parameters = []
                    for parameter in node.getParameters():
                        try:
                            parameter_name = str(parameter.getName())
                        except Exception:
                            parameter_name = ""
                        try:
                            display_name = str(parameter.getDisplayName())
                        except Exception:
                            display_name = parameter_name
                        try:
                            parameter_type = parameter.getType()
                        except Exception:
                            parameter_type = None
                        try:
                            pure = bool(parameter.isPure())
                        except Exception:
                            pure = None
                        parameters.append({"name": parameter_name, "display_name": display_name,
                                           "type": parameter_type, "pure": pure,
                                           "value": _lighting_lab_value(parameter)})
                    matches.append({"material": name, "shader_type": node_type, "parameters": parameters})
                if not any(item["material"] == name for item in matches):
                    unmatched.append({"material": name, "observed_node_types": sorted(set(observed))})
            except Exception as exc:
                errors.append({"material": name, "error": str(exc)[:160]})
        output["lights"][category] = {
            "shader_type": shader_type,
            "candidate_count": len(candidates),
            "candidate_names": candidates[:max_assets],
            "truncated": len(candidates) > max_assets,
            "assets": matches,
            "unmatched_assets": unmatched,
            "errors": errors[:12],
        }
    if "ies" in requested:
        # The current KeyShot library API can omit user-installed IES materials
        # even while their MTL and profile files are present. Record that separate
        # evidence instead of incorrectly reporting that no IES assets exist.
        output["lights"]["ies"]["installed_files"] = _lighting_ies_file_assets(max_assets)
    return output


def op_lighting_ies_assets(c):
    """Read installed IES MTL/profile pairs only; do not load or assign materials."""
    unknown = set(c) - {"op", "limit"}
    if unknown:
        raise ValueError("unsupported IES catalog input: %s" % sorted(unknown)[0])
    limit = int(c.get("limit", 40))
    if limit < 1 or limit > 100:
        raise ValueError("limit must be an integer from 1 to 100")
    return {"schema_version": "1.0", "read_only": True,
            "source": "installed KeyShot user Materials and Textures folders",
            "installed_files": _lighting_ies_file_assets(limit)}


def op_lighting_ies_probe(c):
    """Load one installed IES MTL into the disposable scene, aim it, and read its live graph."""
    import re
    allowed = {"op", "id", "asset_id", "pos", "target", "multiplier", "radius", "axis", "rgb"}
    unknown = set(c) - allowed
    if unknown:
        raise ValueError("unsupported IES probe input: %s" % sorted(unknown)[0])
    light_id = str(c.get("id", ""))
    if not re.match(r"^research_[A-Za-z0-9_-]{1,39}$", light_id):
        raise ValueError("IES probe id must start with research_ and contain at most 48 characters")
    if light_id in REG:
        raise ValueError("probe id already exists; restore the saved checkpoint before creating another light")
    scene = lux.getSceneInfo()
    if os.path.basename(str(scene.get("file", ""))).lower() != "plugintest.bip" or int(scene.get("objects", -1)) != 5:
        raise RuntimeError("IES material probes are restricted to the clean five-form PluginTest.bip scene")
    if _scene_unit_snapshot() != {"unit": "mm", "unitScale": 1000.0}:
        raise RuntimeError("Set the disposable five-form scene to millimeters before the IES probe")
    tree = _lighting_render_state().get("tree")
    forms = {"Sphere", "Torus", "Cube", "Rounded Cube", "Cylinder"}
    if not isinstance(tree, list) or not forms.issubset({item.get("name") for item in tree}):
        raise RuntimeError("The clean five-form product inventory is not intact")

    asset_id = str(c.get("asset_id", "")).replace("\\", "/")
    if not asset_id.startswith("Light/IES Light/") or ".." in asset_id.split("/") or not asset_id.lower().endswith(".mtl"):
        raise ValueError("asset_id must be an installed relative path under Light/IES Light")
    material_root = os.path.abspath(lux.getKeyShotFolder(lux.FOLDER_MATERIALS))
    mtl_path = os.path.abspath(os.path.join(material_root, *asset_id.split("/")))
    if os.path.commonpath((material_root, mtl_path)) != material_root or not os.path.isfile(mtl_path):
        raise ValueError("The requested IES material file is outside the installed KeyShot light library or is missing")
    with open(mtl_path, "r", encoding="utf-8", errors="replace") as source:
        content = source.read()
    if "lux_ies_light" not in content:
        raise ValueError("The selected MTL file does not declare a lux_ies_light graph")
    profile_match = re.search(r'"file"\s+"([^"]+)"', content)
    if not profile_match:
        raise ValueError("The selected IES material does not name a photometric profile")
    profile_name = os.path.basename(profile_match.group(1).replace("\\", "/"))
    ies_root = os.path.join(material_root, "Light", "IES Light")
    profile_root = os.path.join(os.path.dirname(material_root), "Textures", "IES Profiles")
    profile_candidate = os.path.join(profile_root, os.path.relpath(os.path.dirname(mtl_path), ies_root), profile_name)
    if not os.path.isfile(profile_candidate):
        profile_candidate = ""
        for profile_dir, profile_subdirs, profile_files in os.walk(profile_root):
            profile_subdirs.sort(key=str.lower)
            match = next((filename for filename in profile_files if filename.lower() == profile_name.lower()), None)
            if match:
                profile_candidate = os.path.join(profile_dir, match)
                break
    if not profile_candidate:
        raise ValueError("The IES material's referenced profile is not present in the installed IES Profiles folder")
    asset = {"profile_relative_path": os.path.relpath(profile_candidate, profile_root).replace("\\", "/")}

    pos = tuple(float(x) for x in c.get("pos", ()))
    target = tuple(float(x) for x in c.get("target", ()))
    if len(pos) != 3 or len(target) != 3 or _len(_sub(target, pos)) < 1e-4:
        raise ValueError("pos and target must be distinct 3D points in millimeters")
    multiplier = float(c.get("multiplier", 1.0))
    radius = float(c.get("radius", 0.0))
    axis_value = c.get("axis")
    if axis_value is not None and (isinstance(axis_value, bool) or not isinstance(axis_value, (int, float)) or axis_value < 0 or axis_value > 5):
        raise ValueError("axis must be a KeyShot light-axis option from 0 through 5")
    if not (0.001 <= multiplier <= 1000000.0 and 0.0 <= radius <= 10000.0):
        raise ValueError("IES multiplier or radius is outside the supported probe range")
    rgb = c.get("rgb")
    if rgb is not None and (not isinstance(rgb, (list, tuple)) or len(rgb) != 3 or any(not isinstance(x, (int, float)) or x < 0 or x > 1 for x in rgb)):
        raise ValueError("rgb must contain three values from 0 to 1")

    materials_before = set(lux.getSceneMaterials())
    loader = getattr(lux, "loadMaterials", None)
    if not callable(loader):
        raise RuntimeError("This KeyShot runtime does not expose the documented in-project MTL material loader")
    loaded_result = loader(mtl_path)
    lux.sync()
    loaded_names = _material_names_from_load(loaded_result)
    candidate_names = list(dict.fromkeys(loaded_names + sorted(set(lux.getSceneMaterials()) - materials_before)))
    material_name = None
    shader_node = None
    for name in candidate_names:
        try:
            graph = lux.getMaterialGraph(name)
            for candidate in graph.getNodes():
                if _lighting_lab_type(candidate) == "lux_ies_light":
                    values = {str(parameter.getName()): _lighting_lab_value(parameter) for parameter in candidate.getParameters()}
                    if os.path.basename(str(values.get("file", "")).replace("\\", "/")).lower() == profile_name.lower():
                        material_name, shader_node = name, candidate
                        break
            if shader_node is not None:
                break
        except Exception:
            continue
    if shader_node is None:
        library_names = []
        try:
            library_names = [str(name) for name in lux.getLibraryMaterials()
                             if profile_name.lower() in str(name).lower() or "ies" in str(name).lower()]
        except Exception:
            pass
        raise RuntimeError("KeyShot did not load the selected IES MTL as an in-project lux_ies_light material "
                           "(loadMaterials returned %s; new scene materials: %s; matching library names: %s)" %
                           (repr(loaded_result)[:180], ", ".join(candidate_names[:12]) or "none",
                            ", ".join(library_names[:12]) or "none"))

    node, created_node_ids, created_geometry_ids, units_before = _import_panel()
    REG[light_id] = {"obj_id": node.getID(), "mat": material_name,
                     "spec": dict(c), "created_node_ids": created_node_ids,
                     "created_geometry_ids": created_geometry_ids, "mat_owned": material_name not in materials_before,
                     "scene_unit": units_before, "probe_type": "ies"}
    node.setName(PREFIX + light_id)
    parent = node.getParent()
    if parent is not None and str(parent.getID()) in set(str(value) for value in created_node_ids) and parent.isGroup():
        parent.setName(PREFIX + light_id + "_grp")
    transform, direction, roll_total = spotlight_matrix(pos, target, 0.0)
    node.applyTransform(transform, absolute=True)
    lux.setObjectMaterial(material_name, node.getID())
    assigned = _material_name(lux.getObjectMaterial(node.getID()))
    if not assigned:
        raise RuntimeError("KeyShot did not assign the loaded IES material to the tracked carrier")
    REG[light_id]["mat"] = assigned
    graph = lux.getMaterialGraph(assigned)
    for candidate in graph.getNodes():
        if _lighting_lab_type(candidate) == "lux_ies_light":
            shader_node = candidate
            break
    if shader_node is None:
        raise RuntimeError("The assigned material no longer exposes lux_ies_light")
    wanted = {"multiplier": multiplier, "radius": radius}
    if axis_value is not None:
        wanted["light axis"] = axis_value
    if rgb is not None:
        wanted["color"] = tuple(float(x) for x in rgb)
    found = set()
    readback = {}
    for parameter in shader_node.getParameters():
        name = str(parameter.getName())
        if name in wanted:
            parameter.setValue(wanted[name])
            found.add(name)
        readback[name] = _lighting_lab_value(parameter)
    if not {"file", "multiplier", "color", "radius", "light axis"}.issubset(set(readback)):
        raise RuntimeError("The assigned IES graph is missing one or more expected photometric controls")
    if os.path.basename(str(readback.get("file", "")).replace("\\", "/")).lower() != profile_name.lower():
        raise RuntimeError("The assigned IES graph does not retain the discovered profile reference")
    lux.sync()
    REG[light_id]["spec"] = dict(c)
    return {"schema_version": "1.0", "id": light_id, "type": "ies", "created": True,
            "material": assigned, "shader_type": "lux_ies_light", "asset_id": asset_id,
            "profile": profile_name, "profile_exists": True, "profile_relative_path": asset.get("profile_relative_path"),
            "pos_mm": list(pos), "target_mm": list(target),
            "aim_direction_local_minus_y": [round(float(x), 6) for x in direction],
            "carrier_node_ids": [str(value) for value in created_node_ids],
            "carrier_geometry_ids": [str(value) for value in created_geometry_ids],
            "parameters_written": sorted(found), "readback": readback,
            "orientation": "The carrier local -Y axis was aligned with the target ray; the MTL light-axis enum is also recorded for render verification."}


LIGHT_PASS_METHODS = {
    "direct": "setOutputDirectLightingPass",
    "indirect": "setOutputIndirectLightingPass",
    "reflection": "setOutputReflectionPass",
    "shadow": "setOutputShadowPass",
    "raw": "setOutputRawPass",
    "clown": "setOutputClownPass",
    "depth": "setOutputDepthPass",
    "normals": "setOutputNormalsPass",
}
LIGHT_PASS_SUFFIXES = {
    "lighting": "direct", "gi": "indirect", "reflection": "reflection",
    "shadow": "shadow", "raw": "raw", "clown": "clown",
    "depth": "depth", "normals": "normals",
}


def _lighting_render_state():
    """Small read-only scene signature used to verify that evidence rendering is non-destructive."""
    state = {}
    for key, getter in (("scene", lux.getSceneInfo), ("camera", read_camera),
                        ("materials", lux.getSceneMaterials), ("objects", lux.getObjects)):
        try:
            value = getter()
            if key in ("materials", "objects"):
                value = sorted(str(x) for x in value)
            state[key] = value
        except Exception as exc:
            state[key] = {"read_error": str(exc)[:160]}
    try:
        state["environment"] = op_env_info({})
    except Exception as exc:
        state["environment"] = {"read_error": str(exc)[:160]}
    try:
        geometry_ids = set(lux.getObjects())
        tree = []
        for node in _scene_nodes():
            try:
                try: parent = node.getParent()
                except Exception: parent = None  # the scene-tree root has no parent
                item = {"id": node.getID(), "name": node.getName() or "", "kind": node.getKind(),
                        "parent_id": parent.getID() if parent is not None else None,
                        "hidden": bool(node.isHidden()), "is_object": bool(node.isObject()),
                        "is_group": bool(node.isGroup())}
                if item["is_object"] or node.getID() in geometry_ids:
                    try: item["material"] = _material_name(lux.getObjectMaterial(node.getID()))
                    except Exception as exc: item["material_read_error"] = str(exc)[:120]
            except Exception as exc:
                item = {"id": str(node.getID()), "read_error": str(exc)[:120]}
            tree.append(item)
        state["tree"] = sorted(tree, key=lambda item: (str(item.get("id", "")), item.get("name", "")))
    except Exception as exc:
        state["tree"] = {"read_error": str(exc)[:160]}
    try:
        state["render_options_hash"] = _lighting_hash(lux.getRenderOptions().getDict())
    except Exception as exc:
        state["render_options_hash"] = {"read_error": str(exc)[:160]}
    try:
        state["render_engine"] = lux.getRenderEngine()
    except Exception as exc:
        state["render_engine"] = {"read_error": str(exc)[:160]}
    try:
        state["scene_changed"] = bool(lux.isSceneChanged())
    except Exception:
        state["scene_changed"] = None
    return state


def _lighting_hash(value):
    import hashlib
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _lighting_render_fingerprint(state):
    """Fingerprint scene content while separating KeyShot's render-size and dirty-flag metadata."""
    normalized = dict(state)
    scene = dict(normalized.get("scene") or {})
    metadata = {key: scene.pop(key, None) for key in ("render_width", "render_height")}
    metadata["scene_changed"] = normalized.pop("scene_changed", None)
    normalized["scene"] = scene
    return _lighting_hash(normalized), metadata


def _lighting_camera_pose_preserved(before_camera, before_scene, after_camera, after_scene):
    """Compare camera pose in meters when setSceneUnit changes coordinate units."""
    if not isinstance(before_camera, dict) or not isinstance(after_camera, dict):
        return False, None
    before_scale = float((before_scene or {}).get("unitScale", 0.0) or 0.0)
    after_scale = float((after_scene or {}).get("unitScale", 0.0) or 0.0)
    ratios = []
    for key in ("pos", "pivot"):
        old = before_camera.get(key); new = after_camera.get(key)
        if not isinstance(old, (list, tuple)) or not isinstance(new, (list, tuple)) or len(old) != 3 or len(new) != 3:
            return False, None
        for a, b in zip(old, new):
            if abs(float(a)) > 1e-5:
                ratios.append(float(b) / float(a))
    if not ratios:
        return False, None
    ratios.sort()
    factor = ratios[len(ratios) // 2]
    expected = after_scale / before_scale if before_scale > 0 and after_scale > 0 else factor
    if expected <= 0 or abs(factor - expected) > max(1e-3, abs(expected) * 1e-4):
        return False, factor
    # An unknown unit has no reported scale. The observed coordinate factor supplies
    # the conversion for this before/after pair; known units use KeyShot's unitScale.
    effective_before_scale = before_scale if before_scale > 0 else after_scale / factor
    if effective_before_scale <= 0 or after_scale <= 0:
        return False, factor
    for key in ("pos", "pivot"):
        old = before_camera[key]; new = after_camera[key]
        for a, b in zip(old, new):
            if abs(float(a) / effective_before_scale - float(b) / after_scale) > 1e-4:
                return False, factor
    for key in ("dir", "up"):
        old = before_camera.get(key); new = after_camera.get(key)
        if not isinstance(old, (list, tuple)) or not isinstance(new, (list, tuple)) or len(old) != len(new):
            return False, factor
        if any(abs(float(a) - float(b)) > 1e-5 for a, b in zip(old, new)):
            return False, factor
    for key in ("dist", "fov", "focal"):
        try:
            if abs(float(before_camera[key]) - float(after_camera[key])) > 1e-4:
                return False, factor
        except Exception:
            return False, factor
    return True, factor


def op_lighting_scene_snapshot(c):
    """Capture a read-only identity and settings snapshot for lighting experiments."""
    unknown = set(c) - {"op"} if isinstance(c, dict) else set()
    if unknown:
        raise ValueError("lighting_scene_snapshot takes no inputs")
    state = _lighting_render_state()
    # A deleted SceneNode can still own a geometry ID after an import rollback.
    # Include deleted nodes that belong to Director's retained ownership records so
    # recovery can target only the exact failed import instead of clearing the scene.
    owned_ids = set()
    ownership = {}
    for lid, ent in REG.items():
        node_ids = sorted(str(value) for value in ent.get("created_node_ids", ()))
        geometry_ids = sorted(str(value) for value in ent.get("created_geometry_ids", ()))
        ownership[str(lid)] = {"object_id": str(ent.get("obj_id", "")),
                               "node_ids": node_ids, "geometry_ids": geometry_ids,
                               "material": str(ent.get("mat", "")),
                               "material_owned": bool(ent.get("mat_owned"))}
        owned_ids.update(node_ids)
    deleted_owned_nodes = []
    deleted_read_error = None
    if owned_ids:
        try:
            root = lux.getSceneTree()
            candidates = root.find(name="", deleted=True)
            for node in candidates:
                node_id = str(node.getID())
                if node_id not in owned_ids or not node.isDeleted():
                    continue
                item = {"id": node_id, "name": node.getName() or "", "kind": node.getKind()}
                try:
                    parent = node.getParent()
                    item["parent_id"] = str(parent.getID()) if parent is not None else None
                except Exception as exc:
                    item["parent_read_error"] = str(exc)[:120]
                deleted_owned_nodes.append(item)
        except Exception as exc:
            deleted_read_error = str(exc)[:160]
    deleted_owned_nodes.sort(key=lambda item: (item["id"], item["name"]))
    state["deleted_owned_nodes"] = deleted_owned_nodes
    return {"schema_version": "1.0", "read_only": True,
            "keyshot": {"display_version": lux.getKeyShotDisplayVersion(), "version": lux.getKeyShotVersion()},
            "scene": state.get("scene"),
            "camera": state.get("camera"), "environment": state.get("environment"),
            "scene_materials": state.get("materials"), "geometry_ids": state.get("objects"),
            "tree": state.get("tree"), "render_options_hash": state.get("render_options_hash"),
            "scene_changed": state.get("scene_changed"),
            "deleted_owned_nodes": deleted_owned_nodes,
            "deleted_node_read_error": deleted_read_error,
            "director_ownership": ownership,
            "scene_signature": _lighting_hash(state)}


def op_lighting_restore_research_checkpoint(c):
    """Reopen the currently open five-form PluginTest checkpoint to discard only disposable research edits."""
    unknown = set(c) - {"op", "expected_path"} if isinstance(c, dict) else set()
    if unknown:
        raise ValueError("lighting_restore_research_checkpoint accepts only expected_path")
    expected_path = c.get("expected_path")
    if not isinstance(expected_path, str) or not expected_path.strip():
        raise ValueError("expected_path must be the absolute path from the current scene snapshot")
    before = _lighting_render_state()
    scene_before = before.get("scene") or {}
    current_path = scene_before.get("file") or scene_before.get("file name") or scene_before.get("filename")
    norm = lambda value: os.path.normcase(os.path.abspath(os.path.normpath(str(value).replace("/", os.sep))))
    if not current_path or norm(current_path) != norm(expected_path):
        raise RuntimeError("Current KeyShot scene path does not match expected_path; refusing to reopen another file")
    if os.path.basename(current_path).lower() != "plugintest.bip" or not os.path.isfile(current_path):
        raise RuntimeError("Checkpoint restore is restricted to the saved PluginTest.bip research scene")

    forms = {"Sphere", "Torus", "Cube", "Rounded Cube", "Cylinder"}
    tree = before.get("tree")
    if not isinstance(tree, list) or not forms.issubset({item.get("name") for item in tree}):
        raise RuntimeError("The five-form research scene is not intact; refusing checkpoint restore")
    owned_node_ids = set()
    owned_geometry_ids = set()
    for light_id, entry in REG.items():
        if not str(light_id).startswith(("research_", "lighting_")):
            raise RuntimeError("Tracked non-research light exists; refusing to discard it with the checkpoint")
        owned_node_ids.update(str(value) for value in entry.get("created_node_ids", ()))
        owned_geometry_ids.update(str(value) for value in entry.get("created_geometry_ids", ()))
    live_geometry_ids = set(str(value) for value in lux.getObjects())
    owned_live_object_ids = {str(item.get("id")) for item in tree
                             if str(item.get("id")) in owned_node_ids and item.get("is_object")}
    # A failed import can leave a deleted SceneNode whose geometry ID remains in
    # lux.getObjects(). Count that extra only when its exact ID is in our recorded
    # research ownership set; never let an unexplained geometry pass the guard.
    owned_live_geometry_ids = owned_geometry_ids.intersection(live_geometry_ids)
    owned_live_object_ids.update(owned_live_geometry_ids)
    owned_live_objects = len(owned_live_object_ids)
    if int(scene_before.get("objects", -1)) != 5 + owned_live_objects:
        raise RuntimeError("Scene object count does not match the five products plus tracked research lights; refusing checkpoint restore")
    base_names = forms | {"Default", "lux_root"}
    unexpected = [item for item in tree
                  if item.get("name") not in base_names and str(item.get("id")) not in owned_node_ids]
    if unexpected:
        raise RuntimeError("Unowned scene-tree items exist; refusing to discard them: %s" %
                           ", ".join(str(item.get("name", item.get("id"))) for item in unexpected[:8]))

    opener = getattr(lux, "openFile", None)
    if not callable(opener):
        raise RuntimeError("This KeyShot runtime does not expose the documented openFile checkpoint operation")
    opener(current_path, dontAsk=True)
    lux.sync()
    after = _lighting_render_state()
    scene_after = after.get("scene") or {}
    after_path = scene_after.get("file") or scene_after.get("file name") or scene_after.get("filename")
    after_tree = after.get("tree")
    after_names = {item.get("name") for item in after_tree} if isinstance(after_tree, list) else set()
    expected_materials = {"Aluminum Polished #1", "Glass (Solid) White #1", "Hard Rough Plastic Grey #1",
                          "Hard Shiny Plastic Black #1", "Hard Shiny Plastic Grey #1"}
    forms_verified = int(scene_after.get("objects", -1)) == 5 and forms.issubset(after_names)
    tree_verified = isinstance(after_tree, list) and not [item for item in after_tree if item.get("name") not in base_names]
    materials_verified = set(after.get("materials") or ()) == expected_materials
    path_verified = bool(after_path and norm(after_path) == norm(expected_path))
    if not (forms_verified and tree_verified and materials_verified and path_verified):
        raise RuntimeError("Checkpoint reopened but the expected five-form inventory did not verify; inspect the scene before continuing")

    # A KeyShot .bip can reopen with unknown display units even when the user had
    # configured millimeters in the unsaved session. Reapply mm after verifying
    # the exact disposable checkpoint, preserving its geometry and camera pose.
    unit_setup = op_lighting_configure_scene_mm({"op": "lighting_configure_scene_mm"})
    if not (unit_setup.get("units_verified") and unit_setup.get("forms_verified") and
            unit_setup.get("non_camera_identity_preserved") and unit_setup.get("camera_pose_preserved")):
        raise RuntimeError("Checkpoint reopened, but its millimeter setup did not verify; inspect the scene before continuing")
    after = _lighting_render_state()
    scene_after = after.get("scene") or {}
    after_path = scene_after.get("file") or scene_after.get("file name") or scene_after.get("filename")
    path_verified = bool(after_path and norm(after_path) == norm(expected_path))
    forms_verified = int(scene_after.get("objects", -1)) == 5 and forms.issubset({item.get("name") for item in after.get("tree", [])})
    if not (path_verified and forms_verified and scene_after.get("unit") == "mm" and
            abs(float(scene_after.get("unitScale", 0.0) or 0.0) - 1000.0) < 1e-6):
        raise RuntimeError("Checkpoint cleanup finished without the expected five-form millimeter scene; inspect before continuing")

    discarded_ids = sorted(str(value) for value in REG.keys())
    REG.clear()
    ENV_STATE["prev"] = None
    return {"schema_version": "1.0", "reopened": True, "scene_path": after_path,
            "discarded_research_light_ids": discarded_ids,
            "forms_verified": forms_verified, "tree_verified": tree_verified,
            "materials_verified": materials_verified, "path_verified": path_verified,
            "discarded_owned_geometry_ids": sorted(owned_geometry_ids),
            "units_verified": unit_setup.get("units_verified"), "unit_setup": unit_setup,
            "scene_changed_after": after.get("scene_changed"),
            "before_signature": _lighting_hash(before), "after_signature": _lighting_hash(after),
            "before_scene": scene_before, "after_scene": scene_after}


def op_lighting_configure_scene_mm(c):
    """Set a five-form disposable research scene to millimeters while preserving scale."""
    unknown = set(c) - {"op"} if isinstance(c, dict) else set()
    if unknown:
        raise ValueError("lighting_configure_scene_mm takes no inputs")
    before = _lighting_render_state()
    before_scene = before.get("scene") or {}
    expected_forms = {"Sphere", "Torus", "Cube", "Rounded Cube", "Cylinder"}
    before_tree = before.get("tree")
    if not isinstance(before_tree, list):
        raise RuntimeError("Cannot verify the five-form research scene tree; no unit change was attempted.")
    forms_before = sorted(item.get("name", "") for item in before_tree if item.get("name") in expected_forms)
    if int(before_scene.get("objects", -1)) != 5 or set(forms_before) != expected_forms:
        raise RuntimeError("Unit setup is restricted to the clean five-form research scene; no unit change was attempted.")
    if before_scene.get("unit") == "mm" and abs(float(before_scene.get("unitScale", 0.0) or 0.0) - 1000.0) < 1e-6:
        applied = False
    else:
        unit_mm = getattr(lux, "UNIT_MM", None)
        if unit_mm is None or not callable(getattr(lux, "setSceneUnit", None)):
            raise RuntimeError("This KeyShot runtime does not expose the millimeter scene-unit setter.")
        # Keep the model's physical scale while assigning the requested display unit.
        lux.setSceneUnit(unit_mm, True)
        lux.sync()
        applied = True
    after = _lighting_render_state()
    after_scene = after.get("scene") or {}
    after_tree = after.get("tree")
    if not isinstance(after_tree, list):
        forms_after = []
    else:
        forms_after = sorted(item.get("name", "") for item in after_tree if item.get("name") in expected_forms)
    identity_keys = ("objects", "materials", "tree", "environment", "render_options_hash")
    non_camera_identity_preserved = _lighting_hash({key: before.get(key) for key in identity_keys}) == _lighting_hash({key: after.get(key) for key in identity_keys})
    camera_pose_preserved, camera_coordinate_factor = _lighting_camera_pose_preserved(
        before.get("camera"), before_scene, after.get("camera"), after_scene)
    identity_preserved = non_camera_identity_preserved and camera_pose_preserved
    units_verified = after_scene.get("unit") == "mm" and abs(float(after_scene.get("unitScale", 0.0) or 0.0) - 1000.0) < 1e-6
    forms_verified = int(after_scene.get("objects", -1)) == 5 and set(forms_after) == expected_forms
    return {"schema_version": "1.0", "keyshot": {"display_version": lux.getKeyShotDisplayVersion(), "version": lux.getKeyShotVersion()},
            "applied": applied, "before": before_scene, "after": after_scene,
            "forms_before": forms_before, "forms_after": forms_after,
            "units_verified": units_verified, "forms_verified": forms_verified,
            "identity_preserved": identity_preserved,
            "non_camera_identity_preserved": non_camera_identity_preserved,
            "camera_pose_preserved": camera_pose_preserved,
            "camera_coordinate_factor": camera_coordinate_factor,
            "before_signature": _lighting_hash(before), "after_signature": _lighting_hash(after)}


def op_lighting_render_passes(c):
    """Capture bounded beauty and diagnostic passes with detached render options; never changes or saves the scene."""
    run_id = str(c.get("run_id", ""))
    if not __import__("re").match(r"^[0-9a-f-]{36}$", run_id, __import__("re").I):
        raise ValueError("run_id must be a UUID supplied by the local research recorder")
    requested = c.get("passes", ["clown", "reflection", "shadow"])
    if not isinstance(requested, (list, tuple)) or not requested or len(requested) > len(LIGHT_PASS_METHODS):
        raise ValueError("passes must contain 1 to 8 supported diagnostic pass names")
    requested = list(dict.fromkeys(str(x).lower() for x in requested))
    if len(requested) != len(c.get("passes", requested)) or any(x not in LIGHT_PASS_METHODS for x in requested):
        raise ValueError("passes may contain unique values from direct, indirect, reflection, shadow, raw, clown, depth, normals")
    try:
        width = int(c.get("width", 640)); height = int(c.get("height", 400))
        seconds = float(c.get("secs", 2.0))
    except (TypeError, ValueError):
        raise ValueError("width and height must be even integers; secs must be numeric")
    if width < 320 or width > 1280 or height < 200 or height > 960 or width % 2 or height % 2:
        raise ValueError("render dimensions must be even and within 320x200 to 1280x960")
    if seconds < 0.5 or seconds > 8.0:
        raise ValueError("secs must be between 0.5 and 8 seconds")
    render_engine = str(c.get("render_engine", "current")).lower()
    engine_names = {
        "product_cpu": "RENDER_ENGINE_PRODUCT",
        "interior_cpu": "RENDER_ENGINE_INTERIOR",
        "product_gpu": "RENDER_ENGINE_PRODUCT_GPU",
        "interior_gpu": "RENDER_ENGINE_INTERIOR_GPU",
    }
    if render_engine != "current" and render_engine not in engine_names:
        raise ValueError("render_engine must be current, product_cpu, interior_cpu, product_gpu, or interior_gpu")
    engine_before = lux.getRenderEngine()
    target_engine = getattr(lux, engine_names[render_engine]) if render_engine != "current" else engine_before
    engine_values = {name: getattr(lux, constant) for name, constant in engine_names.items() if hasattr(lux, constant)}
    if render_engine != "current" and target_engine is None:
        raise RuntimeError("This KeyShot runtime does not expose the requested render-engine constant")

    root = os.path.join(SHOTS, "lighting-lab", run_id)
    os.makedirs(root, exist_ok=False)
    dst = os.path.join(root, "beauty.png")
    current = lux.getRenderOptions()
    before_options = current.getDict()
    before_state = _lighting_render_state()
    # Clone the current settings, then explicitly disable every pass before enabling the requested set.
    # This preserves all user settings while avoiding inherited pass outputs and global option mutation.
    opts = lux.RenderOptions(before_options)
    for name, method in LIGHT_PASS_METHODS.items():
        setter = getattr(opts, method, None)
        if not callable(setter) and name in requested:
            raise RuntimeError("KeyShot RenderOptions is missing verified pass setter %s" % method)
        if callable(setter):
            setter(False)
    for name in requested:
        getattr(opts, LIGHT_PASS_METHODS[name])(True)
    opts.setOutputAlphaChannel(False)
    opts.setMaxTimeRendering(seconds)
    engine_during = engine_before
    try:
        if render_engine != "current":
            lux.setRenderEngine(target_engine)
            engine_during = lux.getRenderEngine()
            if engine_during != target_engine:
                raise RuntimeError("KeyShot did not switch to the requested temporary render engine")
        t0 = time.time()
        lux.renderImage(path=dst, width=width, height=height, opts=opts)
        elapsed = round(time.time() - t0, 3)
    finally:
        if render_engine != "current":
            lux.setRenderEngine(engine_before)
    engine_after = lux.getRenderEngine()
    if engine_after != engine_before:
        raise RuntimeError("KeyShot did not restore the original render engine after the diagnostic render")

    after_state = _lighting_render_state()
    after_options = lux.getRenderOptions().getDict()
    found = []
    suffix_to_type = {"_" + suffix: kind for suffix, kind in LIGHT_PASS_SUFFIXES.items()}
    for filename in sorted(os.listdir(root)):
        full = os.path.join(root, filename)
        if not os.path.isfile(full):
            continue
        import hashlib
        digest = hashlib.sha256()
        with open(full, "rb") as output_file:
            for chunk in iter(lambda: output_file.read(1024 * 1024), b""):
                digest.update(chunk)
        stem = os.path.splitext(filename)[0].lower()
        kind = "beauty" if filename.lower() == "beauty.png" else None
        if kind is None:
            for suffix, pass_name in suffix_to_type.items():
                if stem.endswith(suffix):
                    kind = pass_name
                    break
        found.append({"pass": kind or "unknown", "name": filename, "path": full,
                      "bytes": os.path.getsize(full), "sha256": digest.hexdigest(),
                      "extension": os.path.splitext(filename)[1].lower()})
    found_types = set(item["pass"] for item in found)
    missing = [name for name in requested if name not in found_types]
    before_option_hash = _lighting_hash(before_options)
    after_option_hash = _lighting_hash(after_options)
    before_state_hash = _lighting_hash(before_state)
    after_state_hash = _lighting_hash(after_state)
    before_fingerprint, before_render_metadata = _lighting_render_fingerprint(before_state)
    after_fingerprint, after_render_metadata = _lighting_render_fingerprint(after_state)
    return {"schema_version": "1.0", "run_id": run_id, "requested_passes": requested,
            "width": width, "height": height, "max_render_seconds": seconds, "elapsed_seconds": elapsed,
            "render_engine_requested": render_engine, "render_engine_values": engine_values,
            "render_engine_before": engine_before, "render_engine_during": engine_during,
            "render_engine_after": engine_after,
            "files": found, "missing_passes": missing,
            "scene_unchanged": before_fingerprint == after_fingerprint,
            "scene_raw_unchanged": before_state_hash == after_state_hash,
            "scene_render_metadata": {"before": before_render_metadata, "after": after_render_metadata},
            "render_options_unchanged": before_option_hash == after_option_hash,
            "scene_before_hash": before_state_hash, "scene_after_hash": after_state_hash,
            "render_options_before_hash": before_option_hash, "render_options_after_hash": after_option_hash}


LIGHT_OPS = {"subject": op_subject, "light_set": op_light_set, "light_remove": op_light_remove,
             "lights_clear": op_lights_clear, "lights_list": op_lights_list, "env_set": op_env_set,
             "env_info": op_env_info, "env_restore": op_env_restore,
             "light_visibility": op_light_visibility,
             "studio_off": op_studio_off, "image_style": op_image_style,
             "lighting_control_surface": op_lighting_control_surface,
             "lighting_inspect": op_lighting_inspect,
             "lighting_ies_assets": op_lighting_ies_assets,
             "lighting_scene_snapshot": op_lighting_scene_snapshot,
             "lighting_restore_research_checkpoint": op_lighting_restore_research_checkpoint,
             "lighting_point_spot_probe": op_lighting_point_spot_probe,
             "lighting_ies_probe": op_lighting_ies_probe,
             "lighting_configure_scene_mm": op_lighting_configure_scene_mm,
             "lighting_render_passes": op_lighting_render_passes}
