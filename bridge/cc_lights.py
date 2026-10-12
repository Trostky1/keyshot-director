# cc_lights.py - lighting engine, runs inside KeyShot (exec'd by cc_ops.py; shares its namespace).
# A "light" is a flat rectangular panel (imported OBJ plane) with a KeyShot library area-light
# material whose power / colour / visibility we edit through the material graph.
# Everything we create is named CC_L_<id> and registered, so it can be updated or removed without
# touching the user's product.  Lights are placed in world space (mm) and aimed at a target point.
import math, os

PANEL_OBJ = os.path.join(os.path.dirname(SHOTS), "assets", "cc_light_panel.obj")
PREFIX = "CC_L_"
LIB_LIGHT = "Area Light 1200 Lumen White"
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
def _import_panel():
    before = set(lux.getObjects())
    o = lux.getImportOptions(ext="obj", getDefaults=True)
    o.update({"adjust_camera_look_at": False, "adjust_environment": False, "camera_import": False,
              "center_geometry": False, "snap_to_ground": False, "import_type": 0, "geometry_units": 1000.0,
              "up_vector": 1, "inclusion_options": 1, "include_nurbs": False,
              "separate_materials": True, "same_coordinates": True})
    lux.importFile(PANEL_OBJ, showOpts=False, dontAsk=True, opts=o)
    lux.sync()
    new = sorted(set(lux.getObjects()) - before)
    if not new:
        raise RuntimeError("panel import added no object")
    oid = new[-1]
    cands = lux.getSceneTree().find(name="cc_light_panel", types=lux.NODE_TYPE_OBJECT)
    node = [n for n in cands if n.getID() == oid]
    if not node:
        raise RuntimeError("could not locate imported panel node %s" % oid)
    return node[0]


def _light_node(oid, lid=None):
    # try the exact name first, then the prefix, and always confirm by node ID
    for name in ([PREFIX + lid] if lid else []) + [PREFIX]:
        for n in lux.getSceneTree().find(name=name, types=lux.NODE_TYPE_OBJECT):
            if n.getID() == oid:
                return n
    return None


def _mesh_light_node(mname):
    g = lux.getMaterialGraph(mname)
    for n in g.getNodes():
        t = n.getType()
        if isinstance(t, dict) and t.get("name") == "lux_mesh_light":
            return n
    return None


def _set_params(mname, spec, last=None):
    """Set material parameters from spec; with `last` (dict of already-applied values) only the changed ones are written.
    Returns the list of parameter names actually written."""
    want = {}
    if "power" in spec: want["power"] = float(spec["power"])
    if "kelvin" in spec or "rgb" in spec:
        want["color"] = tuple(spec["rgb"]) if "rgb" in spec else kelvin_to_rgb(spec["kelvin"])
    if "visible_eye" in spec: want["visible to the eye"] = bool(spec["visible_eye"])
    if "visible_refl" in spec: want["visible in reflections"] = bool(spec["visible_refl"])
    if "visible_shadows" in spec: want["visible in shadows"] = bool(spec["visible_shadows"])
    if "samples" in spec: want["samples"] = int(spec["samples"])
    if last is not None:
        want = {k: v for k, v in want.items() if last.get(k) != v}
    if not want:
        return []
    n = _mesh_light_node(mname)
    if n is None:
        raise RuntimeError("no mesh-light node in material %s" % mname)
    done = []
    for p in n.getParameters():
        if p.getName() in want:
            p.setValue(want[p.getName()])
            done.append(p.getName())
            if last is not None:
                last[p.getName()] = want[p.getName()]
    return done


def adopt_orphans():
    """Register lights that exist in the scene but not in REG (KeyShot's crash recovery restores our lights while the
    bridge's memory starts empty). Without this, rebuilding a rig would stack a second set on top of the old one."""
    adopted = []
    for n in lux.getSceneTree().find(name=PREFIX, types=lux.NODE_TYPE_OBJECT):
        nm = n.getName() or ""
        if not nm.startswith(PREFIX):
            continue
        lid = nm[len(PREFIX):]
        if lid in REG:
            continue
        try:
            mn = lux.getObjectMaterial(n.getID()); mn = mn[0] if isinstance(mn, (list, tuple)) else mn
        except Exception:
            mn = ""
        REG[lid] = {"obj_id": n.getID(), "mat": mn, "adopted": True,
                    "spec": {"size": [300, 300], "target": [0, 0, 0], "roll": 0.0, "power": 100.0, "kelvin": 5600,
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
    """Create or update a light.  spec keys: id, pos[3], target[3], size[w,h] mm, roll, power (lumens),
    kelvin | rgb, visible_eye, visible_refl, visible_shadows, samples, lib (library material name)."""
    lid = str(c["id"])
    if lid not in REG:
        adopt_orphans()
    spec = dict(REG[lid]["spec"]) if lid in REG else {"size": [300, 300], "target": [0, 0, 0], "roll": 0.0,
                                                      "power": 1200.0, "kelvin": 5600,
                                                      "visible_refl": True, "visible_eye": False}
    spec.update({k: v for k, v in c.items() if k not in ("op",)})
    created = False
    if lid not in REG:
        node = _import_panel()
        node.setName(PREFIX + lid)
        try: node.getParent().setName(PREFIX + lid + "_grp")
        except Exception: pass
        lux.setObjectMaterial(spec.get("lib", LIB_LIGHT), node.getID())
        mn = lux.getObjectMaterial(node.getID())
        mn = mn[0] if isinstance(mn, (list, tuple)) else mn
        REG[lid] = {"obj_id": node.getID(), "mat": mn, "spec": spec}
        created = True
    ent = REG[lid]
    node = _light_node(ent["obj_id"], lid)
    if node is None:
        raise RuntimeError("light node for %s vanished" % lid)
    pos = tuple(round(float(x), 4) for x in spec["pos"]); tgt = tuple(round(float(x), 4) for x in spec["target"])
    size = (round(float(spec["size"][0]), 4), round(float(spec["size"][1]), 4))
    roll = round(float(spec.get("roll", 0.0)), 4)
    # Every KeyShot setter costs real time, so only touch what changed since the last call.
    applied = ent.setdefault("applied", {"xf": None, "params": {}})
    xf = (pos, tgt, size, roll)
    d = _norm(_sub(tgt, pos)); err = None; moved = False
    if applied["xf"] != xf:
        M, d, roll_total = panel_matrix(pos, tgt, size, roll)
        node.applyTransform(M, absolute=True)
        applied["xf"] = xf; moved = True
        bb = node.getBoundingBox(world=True)             # self-check against independently computed corners
        got_lo, got_hi = bb[0].val(), bb[1].val()
        exp_lo, exp_hi = expected_bbox(pos, tgt, size, roll_total, d)
        err = round(max(max(abs(got_lo[i] - exp_lo[i]), abs(got_hi[i] - exp_hi[i])) for i in range(3)), 3)
    changed = _set_params(ent["mat"], spec, applied["params"])
    if moved or changed:
        lux.sync()
    ent["spec"] = spec
    return {"id": lid, "created": created, "material": ent["mat"], "placement_err_mm": err, "moved": moved,
            "params_changed": changed, "dir": [round(x, 4) for x in d]}


def op_light_remove(c):
    lid = str(c["id"])
    if lid not in REG:
        adopt_orphans()  # recover a panel if creation failed after import but before registration
    ent = REG.pop(lid, None)
    if not ent:
        return {"removed": False}
    node = _light_node(ent["obj_id"], lid)
    if node is not None:
        try: node.getParent().delete()
        except Exception: node.delete()
    try: lux.deleteMaterial(ent["mat"])
    except Exception: pass
    lux.sync()
    return {"removed": True}


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
        out[lid] = {"spec": ent["spec"], "material": ent["mat"], "adopted": bool(ent.get("adopted")),
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


LIGHT_OPS = {"subject": op_subject, "light_set": op_light_set, "light_remove": op_light_remove,
             "lights_clear": op_lights_clear, "lights_list": op_lights_list, "env_set": op_env_set,
             "env_info": op_env_info, "env_restore": op_env_restore,
             "light_visibility": op_light_visibility,
             "studio_off": op_studio_off, "image_style": op_image_style}
