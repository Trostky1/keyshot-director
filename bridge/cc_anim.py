# cc_anim.py - animation ops (glTF route). Loaded into cc_ops' namespace; adds to ANIM_OPS.
# SAFETY: never call lux.getAnimations() or lux.createAnimation() (both crash KeyShot). Everything here is
# read-only or goes through importFile / moveToGroup / delete on nodes WE created (names start with CCA_).

ANIM_PREFIX = "CCA_"


def _node_info(n, depth=0, maxdepth=4):
    d = {"name": None, "id": None, "kind": None}
    for k, fn in (("name", n.getName), ("id", n.getID), ("kind", n.getKind)):
        try:
            d[k] = fn()
        except Exception as e:
            d[k] = "ERR %r" % (e,)
    if depth < maxdepth:
        try:
            d["children"] = [_node_info(c, depth + 1, maxdepth) for c in n.getChildren()]
        except Exception:
            pass
    return d


def _find_all(name_prefix=None, name=None):
    out = []
    def walk(n):
        try:
            nm = n.getName()
        except Exception:
            nm = ""
        if (name is not None and nm == name) or (name_prefix and nm.startswith(name_prefix)):
            out.append(n)
        try:
            for c in n.getChildren():
                walk(c)
        except Exception:
            pass
    walk(lux.getSceneTree())
    return out


def _vec(v):
    try:
        return [round(float(x), 4) for x in v]
    except Exception:
        return str(v)


def op_anim_probe(c):
    """E0: read-only. Import options for glTF, animation/camera-ish lux names, scene unit, tree, anim info."""
    out = {}
    try:
        out["gltf_defaults"] = {k: (v if isinstance(v, (int, float, str, bool, type(None))) else str(v))
                                for k, v in lux.getImportOptions(ext="gltf", getDefaults=True).items()}
    except Exception as e:
        out["gltf_defaults"] = "ERR %r" % (e,)
    out["lux_names"] = sorted(n for n in dir(lux) if any(s in n.lower() for s in ("anim", "camera", "keyframe", "timeline", "fps", "export")))
    try:
        out["animation_info"] = lux.getAnimationInfo()
    except Exception as e:
        out["animation_info"] = "ERR %r" % (e,)
    try:
        out["scene_info"] = lux.getSceneInfo()
    except Exception as e:
        out["scene_info"] = "ERR %r" % (e,)
    try:
        out["cameras"] = list(lux.getCameras())
    except Exception as e:
        out["cameras"] = "ERR %r" % (e,)
    out["tree"] = _node_info(lux.getSceneTree(), 0, c.get("depth", 3))
    return out


def op_anim_info(c):
    return lux.getAnimationInfo()


def op_anim_import(c):
    """Import a glTF with animation. c: path, opts (overrides). Reports tree names before/after and anim info."""
    path = c["path"]
    before = {n.getID(): n.getName() for n in lux.getSceneTree().getChildren()}
    opts = lux.getImportOptions(ext="gltf", getDefaults=True)
    opts.update({"import_animation": True, "camera_import": bool(c.get("camera_import", False)),
                 "adjust_camera_look_at": False, "adjust_environment": False,
                 "center_geometry": False, "snap_to_ground": False, "import_type": c.get("import_type", 0)})
    if "up_vector" in c:
        opts["up_vector"] = c["up_vector"]
    if "geometry_units" in c:
        opts["geometry_units"] = c["geometry_units"]
    opts.update(c.get("opts") or {})
    lux.importFile(path, showOpts=False, dontAsk=True, opts=opts)
    lux.sync()
    after = [(n.getID(), n.getName(), n.getKind()) for n in lux.getSceneTree().getChildren() if n.getID() not in before]
    return {"opts_used": {k: (v if isinstance(v, (int, float, str, bool, type(None))) else str(v)) for k, v in opts.items()},
            "new_top_nodes": after, "animation_info": lux.getAnimationInfo(),
            "tree": _node_info(lux.getSceneTree(), 0, c.get("depth", 4))}


def op_anim_tree(c):
    return _node_info(lux.getSceneTree(), 0, c.get("depth", 5))


def op_anim_nodes(c):
    """E8 probe: animation nodes via SceneNode.find(types=NODE_TYPE_ANIMATION). Read-only, but untested - save first."""
    res = []
    for n in lux.getSceneTree().find(types=lux.NODE_TYPE_ANIMATION):
        res.append({"name": n.getName(), "id": n.getID(), "kind": n.getKind()})
    return res


def op_anim_time(c):
    """E2/E7: seek (secs or frame) and report world transforms/bboxes of nodes named in c['names']."""
    if "secs" in c:
        lux.setAnimationTime(float(c["secs"]))
    elif "frame" in c:
        lux.setAnimationFrame(int(c["frame"]))
    lux.sync()
    res = {}
    for nm in c.get("names", []):
        nodes = _find_all(name=nm)
        if not nodes:
            res[nm] = None
            continue
        n = nodes[0]
        r = {}
        try:
            bb = n.getBoundingBox(world=True)
            r["bbox_min"], r["bbox_max"] = _vec(bb[0]), _vec(bb[1])
        except Exception as e:
            r["bbox"] = "ERR %r" % (e,)
        try:
            r["center"] = _vec(n.getCenter(world=True))
        except Exception as e:
            r["center"] = "ERR %r" % (e,)
        try:
            T = n.getTransform(world=True)
            r["transform"] = str(T)
        except Exception as e:
            r["transform"] = "ERR %r" % (e,)
        res[nm] = r
    if c.get("shot"):
        res["_shot"] = op_screenshot({"name": c["shot"]})
    return res


def op_anim_group(c):
    """E5(b): move nodes (by exact name or prefix, optional 'only_ids') under a group node found by name."""
    groups = _find_all(name=c["group"])
    if not groups:
        raise Exception("group %r not found" % c["group"])
    g = groups[0]
    moved = []
    for nm in c.get("children", []):
        for n in _find_all(name=nm):
            if n.getID() == g.getID():
                continue
            n.moveToGroup(g)
            moved.append(nm)
    lux.sync()
    return {"moved": moved, "group_children": [x.getName() for x in g.getChildren()]}


def op_anim_delete(c):
    """Delete nodes whose names start with CCA_ (nodes we created). Refuses anything else."""
    pre = c.get("prefix", ANIM_PREFIX)
    if not pre.startswith(ANIM_PREFIX):
        raise Exception("refusing: prefix must start with %s" % ANIM_PREFIX)
    gone = []
    for n in _find_all(name_prefix=pre):
        nm = n.getName()
        try:
            n.delete()
            gone.append(nm)
        except Exception as e:
            gone.append("%s ERR %r" % (nm, e))
    lux.sync()
    return {"deleted": gone, "animation_info": lux.getAnimationInfo()}


def _kids(n):
    try:
        return [k for k in n.getChildren() if not k.isDeleted()]
    except Exception:
        return None


def op_anim_swap(c):
    """Option 2: match the freshly imported animated copy (model named c['model']) to the original parts by name,
    re-apply the original materials (linked), then hide the originals. Returns the hidden ids for anim_unswap."""
    root = lux.getSceneTree()
    models = [n for n in _find_all(name=c['model']) if not n.isDeleted()]
    if not models:
        raise Exception('model %r not found' % c['model'])
    new_model = max(models, key=lambda n: n.getID())
    old_def = [n for n in _kids(root) if n.getName() == c.get('old_set', 'Default') and n.getID() != new_model.getID()]
    old_def = [n for n in old_def if n.getKind() == lux.NODE_TYPE_MODEL_SET][0]
    new_def = None
    def find_def(n):
        nonlocal new_def
        for k in _kids(n) or []:
            if k.getName() == c.get('old_set', 'Default') and new_def is None:
                new_def = k
            find_def(k)
    find_def(new_model)
    stats = {'matched': 0, 'materials': 0, 'errors': []}
    def match(o, nn):
        ok, nk = _kids(o), _kids(nn)
        if ok is None or nk is None:        # leaf (object): copy material
            try:
                nn.setMaterial(o.getMaterial(), link=True)
                stats['materials'] += 1
            except Exception as e:
                stats['errors'].append('%s: %r' % (o.getName(), e))
            return
        used = set()
        for ko in ok:
            for kn in nk:
                if kn.getID() not in used and kn.getName() == ko.getName():
                    used.add(kn.getID()); stats['matched'] += 1
                    match(ko, kn)
                    break
    hide_ids = []
    only = set(c.get('only') or [])
    for ko in _kids(old_def) or []:
        if ko.getName().startswith(ANIM_PREFIX) or ko.isModel() and ko.getName() in ('e1_turntable', 'vis'):
            continue
        if only and ko.getName() not in only:
            continue
        for kn in _kids(new_def) or []:
            if kn.getName() == ko.getName():
                match(ko, kn)
                ko.hide(); hide_ids.append(ko.getID())
                break
    lux.sync()
    stats['hidden'] = hide_ids
    return stats


def op_anim_unswap(c):
    ids = set(c.get('ids') or [])
    shown = []
    def walk(n):
        for k in _kids(n) or []:
            if k.getID() in ids:
                k.show(); shown.append(k.getName())
            walk(k)
    walk(lux.getSceneTree())
    lux.sync()
    return {'shown': shown}


# ---- frame output: the camera cannot be animated on KeyShot's timeline by script or glTF import (camera imports static),
# so a camera move is rendered frame by frame: the server sets each pose, then asks for one frame.
def op_grab(c):
    """Copy the live viewport to c['path'] (PNG). Removes the file KeyShot drops in Renderings (see op_screenshot)."""
    src = lux.screenshot()
    shutil.copyfile(src, c['path'])
    try:
        if time.time() - os.path.getmtime(src) < 15 and 'renderings' in src.replace(chr(92), '/').lower():
            os.remove(src)
    except Exception:
        pass
    return {'path': c['path']}


def op_render_view(c):
    """Set the camera (pos/pivot/fov) and render one frame with KeyShot's renderer to c['path']."""
    apply_pose(c['pos'], c['pivot'], [0, 1, 0], c.get('fov'))
    opts = lux.getRenderOptions()
    if c.get('samples'):
        opts.setMaxSamplesRendering(int(c['samples']))
    else:
        opts.setMaxTimeRendering(float(c.get('secs', 5)))
    opts.setOutputAlphaChannel(bool(c.get('alpha')))      # always explicit: render options persist between calls
    t0 = time.time()
    kw = {'path': c['path'], 'opts': opts}
    if c.get('width') and c.get('height'):
        kw['width'] = int(c['width']); kw['height'] = int(c['height'])
    lux.renderImage(**kw)
    return {'path': c['path'], 'exists': os.path.exists(c['path']), 'secs': round(time.time() - t0, 2)}


def op_encode_video(c):
    """Encode numbered frames in c['folder'] (pattern c['frames'], e.g. frame.%d.png) to c['video'] (mp4) inside that folder."""
    lux.encodeVideo(folder=c['folder'], frameFiles=c['frames'], videoName=c['video'], fps=int(c['fps']),
                    firstFrame=int(c.get('first', 1)), lastFrame=int(c['last']), keepFrames=True)
    out = os.path.join(c['folder'], c['video'])
    return {'video': out, 'exists': os.path.exists(out), 'size': os.path.getsize(out) if os.path.exists(out) else 0}


ANIM_OPS = {'grab': op_grab, 'render_view': op_render_view, 'encode_video': op_encode_video, 'anim_swap': op_anim_swap, 'anim_unswap': op_anim_unswap, "anim_probe": op_anim_probe, "anim_info": op_anim_info, "anim_import": op_anim_import, "anim_tree": op_anim_tree,
            "anim_nodes": op_anim_nodes, "anim_time": op_anim_time, "anim_group": op_anim_group, "anim_delete": op_anim_delete}
