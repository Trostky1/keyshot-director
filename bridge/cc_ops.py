# cc_ops.py - command implementations, hot-reloaded by cc_bridge.py when this file changes.
# Namespace provides: lux, luxmath, os, json, time, shutil, math, SHOTS, INITIAL (dict or None)
# DEV NOTE: the 'exec' op runs arbitrary Python inside KeyShot when a file is dropped in bridge\cmd. It is for local
# development only and is OFF unless the file bridge\dev.flag exists (that file is never shipped).


def _v(t):
    return [float(x) for x in t]


def read_camera():
    out = {"name": lux.getCamera()}
    for key, fn in (("pos", lux.getCameraPosition), ("pivot", lux.getCameraPivot),
                    ("dir", lux.getCameraDirection), ("lookat", lux.getCameraLookAt),
                    ("up", lux.getCameraUp)):
        try:
            out[key] = _v(fn())
        except Exception as e:
            out[key] = "ERR %r" % (e,)
    for key, fn in (("dist", lux.getCameraDistance), ("fov", lux.getCameraFieldOfView),
                    ("focal", lux.getCameraFocalLength)):
        try:
            out[key] = float(fn())
        except Exception as e:
            out[key] = "ERR %r" % (e,)
    return out


def op_ping(c):
    return {"pong": True}


def op_get_camera(c):
    return read_camera()


def op_initial(c):
    return INITIAL


def op_exec(c):
    if not os.path.exists(os.path.join(os.path.dirname(SHOTS), "dev.flag")):     # off unless the developer opts in locally
        raise Exception("the exec op is disabled (developer only: create bridge/dev.flag to enable)")
    ns = {"lux": lux, "luxmath": luxmath, "math": math, "os": os, "time": time,
          "read_camera": read_camera, "result": None}
    exec(c["code"], ns)
    return ns.get("result")


def op_screenshot(c):
    """Picture of the current view. NOT lux.screenshot(): that call adds a new saved camera to the scene on every use
    (it had piled up thousands) and drops a 5 MB PNG into Renderings. A tiny renderImage does neither."""
    t0 = time.time()
    dst = os.path.join(SHOTS, c.get("name", "shot") + ".png")
    w = int(c.get("width", 640))
    h = int(c.get("height", round(w * 9 / 16 / 2) * 2))
    opts = lux.getRenderOptions()
    opts.setOutputAlphaChannel(False)
    opts.setMaxTimeRendering(float(c.get("secs", 1.2)))
    lux.renderImage(path=dst, width=w - (w % 2), height=h - (h % 2), opts=opts)
    return {"path": dst, "secs": round(time.time() - t0, 3)}


def op_stop(c):
    return {"stopping": True}


# ---- camera pose application -------------------------------------------------------
# KeyShot's camera is orbit-style (pivot + direction + distance); the order of the setters
# matters.  Each strategy is a list of steps; op_calibrate finds which ones actually land
# the eye where we asked, and op_set_view then uses the first winner.

def _norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / n for x in v)


def _steps(name, eye, pivot, up, fov):
    d = tuple(pivot[i] - eye[i] for i in range(3))
    dist = math.sqrt(sum(x * x for x in d))
    nd = _norm(d)
    S = {
        "pivot>dir>dist":  [lambda: lux.setCameraPivot(pt=tuple(pivot)), lambda: lux.setCameraDirection(nd), lambda: lux.setCameraDistance(dist)],
        "dir>pivot>dist":  [lambda: lux.setCameraDirection(nd), lambda: lux.setCameraPivot(pt=tuple(pivot)), lambda: lux.setCameraDistance(dist)],
        "dist>dir>pivot":  [lambda: lux.setCameraDistance(dist), lambda: lux.setCameraDirection(nd), lambda: lux.setCameraPivot(pt=tuple(pivot))],
        "pos>lookat":      [lambda: lux.setCameraPosition(tuple(eye)), lambda: lux.setCameraLookAt(pt=tuple(pivot))],
        "lookat>pos":      [lambda: lux.setCameraLookAt(pt=tuple(pivot)), lambda: lux.setCameraPosition(tuple(eye))],
        "pos>dir":         [lambda: lux.setCameraPosition(tuple(eye)), lambda: lux.setCameraDirection(nd)],
        "dir>pos":         [lambda: lux.setCameraDirection(nd), lambda: lux.setCameraPosition(tuple(eye))],
        "pos>pivot>dir":   [lambda: lux.setCameraPosition(tuple(eye)), lambda: lux.setCameraPivot(pt=tuple(pivot)), lambda: lux.setCameraDirection(nd)],
        "pivot>pos>dir":   [lambda: lux.setCameraPivot(pt=tuple(pivot)), lambda: lux.setCameraPosition(tuple(eye)), lambda: lux.setCameraDirection(nd)],
        "pos>dir>pivot":   [lambda: lux.setCameraPosition(tuple(eye)), lambda: lux.setCameraDirection(nd), lambda: lux.setCameraPivot(pt=tuple(pivot))],
    }
    return S[name]


STRATEGY_NAMES = ["pivot>dir>dist", "dir>pivot>dist", "dist>dir>pivot", "pos>lookat", "lookat>pos",
                  "pos>dir", "dir>pos", "pos>pivot>dir", "pivot>pos>dir", "pos>dir>pivot"]
BEST = {"name": "pos>dir"}
LAST = {}      # last up / fov we set, to skip redundant setter calls


def op_perf(c):
    on = bool(c.get("on", True))
    lux.enablePerformanceMode(on)
    return {"perf": on}


def apply_pose(eye, pivot, up=None, fov=None, strategy=None):
    name = strategy or BEST["name"] or "pos>lookat"
    for step in _steps(name, eye, pivot, up, fov):
        step()
    # each camera setter costs 60-150ms inside KeyShot, so skip ones that wouldn't change anything
    if up is not None and LAST.get("up") != tuple(up):
        lux.setCameraUp(tuple(up))
        LAST["up"] = tuple(up)
    if fov is not None and LAST.get("fov") != round(float(fov), 3):
        lux.setCameraFieldOfView(float(fov))
        LAST["fov"] = round(float(fov), 3)
    lux.sync()
    return name


def _dev(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def op_set_view(c):
    pivot = c.get("pivot") or (INITIAL or {}).get("pivot")
    eye = c["pos"]
    used = apply_pose(eye, pivot, c.get("up"), c.get("fov"), strategy=c.get("strategy"))
    if c.get("noread"):
        return {"strategy": used}
    cam = read_camera()
    cam["strategy"] = used
    return cam


def op_calibrate(c):
    """Try every strategy against a target eye ~90deg around the pivot; report who lands it."""
    cam0 = read_camera()
    pivot = cam0.get("pivot") if isinstance(cam0.get("pivot"), list) else cam0["lookat"]
    eye0 = cam0["pos"]
    rel = [eye0[i] - pivot[i] for i in range(3)]
    ang = math.radians(c.get("deg", 90))
    # rotate eye offset about the world Y axis
    tx = pivot[0] + rel[0] * math.cos(ang) - rel[2] * math.sin(ang)
    tz = pivot[2] + rel[0] * math.sin(ang) + rel[2] * math.cos(ang)
    target = [tx, eye0[1], tz]
    report = []
    winners = []
    for name in STRATEGY_NAMES:
        try:
            # reset to a known state first so strategies don't contaminate each other
            apply_pose(eye0, pivot, cam0.get("up"), cam0.get("fov"), strategy="pos>lookat")
            apply_pose(target, pivot, [0, 1, 0], None, strategy=name)
            got = read_camera()
            err = _dev(got["pos"], target)
            report.append({"strategy": name, "err": round(err, 3), "pos": [round(x, 1) for x in got["pos"]],
                           "dir": [round(x, 3) for x in got["dir"]] if isinstance(got.get("dir"), list) else got.get("dir")})
            if err < 0.5:
                winners.append(name)
        except Exception as e:
            report.append({"strategy": name, "error": repr(e)})
    if winners:
        BEST["name"] = winners[0]
    # put the camera back where we found it (best effort)
    try:
        apply_pose(eye0, pivot, cam0.get("up"), cam0.get("fov"), strategy=BEST["name"] or "pos>lookat")
    except Exception:
        pass
    return {"target": [round(x, 1) for x in target], "start_pos": [round(x, 1) for x in eye0],
            "winners": winners, "best": BEST["name"], "report": report, "after": read_camera()}


def op_reset(c):
    """Re-activate the saved camera, discarding live (unsaved) camera edits."""
    name = c.get("name") or (INITIAL or {}).get("name") or lux.getCamera()
    before = {"unsaved": lux.isCameraUnsaved()}
    lux.setCamera(name)
    lux.sync()
    cam = read_camera()
    cam["reset_from"] = before
    return cam


OPS = {"ping": op_ping, "get_camera": op_get_camera, "initial": op_initial,
       "exec": op_exec, "screenshot": op_screenshot, "stop": op_stop,
       "set_view": op_set_view, "calibrate": op_calibrate, "reset": op_reset, "perf": op_perf}

# ---- lighting engine lives in cc_lights.py; load it into this namespace ----------------------------
LIGHTS_FILE = os.path.join(os.path.dirname(SHOTS), "cc_lights.py")   # SHOTS is <bridge>\shots
try:
    with open(LIGHTS_FILE, "r", encoding="utf-8-sig") as _f:
        exec(compile(_f.read(), LIGHTS_FILE, "exec"), globals())
    OPS.update(LIGHT_OPS)
except Exception:
    import traceback as _tb
    OPS["lights_error"] = (lambda c, _e=_tb.format_exc(): {"error": _e})
    raise
# ---- animation ops (glTF route) live in cc_anim.py ------------------------------------------------------------
ANIM_FILE = os.path.join(os.path.dirname(SHOTS), "cc_anim.py")
try:
    with open(ANIM_FILE, "r", encoding="utf-8-sig") as _f:
        exec(compile(_f.read(), ANIM_FILE, "exec"), globals())
    OPS.update(ANIM_OPS)
except Exception:
    import traceback as _tb2
    OPS["anim_error"] = (lambda c, _e=_tb2.format_exc(): {"error": _e})
# edit stamp for cc_lights.py / cc_anim.py (bump to force a hot reload after editing them): 17
