"""
cc_bridge.py - live bridge v2 (time-limited, hot-reloading ops).

Run from KeyShot's scripting console:
    (set KD_HOME, then exec cc_bridge.py - install.ps1 generates the launcher)

Polls bridge\\cmd\\*.json, runs ops defined in bridge\\cc_ops.py (reloaded whenever that
file changes), writes bridge\\resp\\<id>.json. Ends on op 'stop' or after RUN_SECONDS.
Never calls lux.getAnimations() (known native crash).
"""
import lux, luxmath, os, json, time, shutil, traceback, math

_user32 = None
_msg = None
_qt_core = None
if os.name == "nt":
    try:
        import ctypes
        import ctypes.wintypes as wt
        _user32 = ctypes.windll.user32
        _msg = wt.MSG()
    except Exception:
        _user32 = None
else:
    # KeyShot embeds Qt on macOS. Process its GUI events between bridge operations
    # so the viewport and scripting window remain responsive while this loop runs.
    try:
        from PySide6.QtCore import QCoreApplication as _qt_core
    except Exception:
        try:
            from PySide2.QtCore import QCoreApplication as _qt_core
        except Exception:
            _qt_core = None


def pump():
    """Process host GUI events between commands; never in the middle of one."""
    if _user32 is None:
        if _qt_core is not None:
            try:
                app = _qt_core.instance()
                if app is not None:
                    app.processEvents()
            except Exception:
                pass
        return
    n = 0
    while n < 500 and _user32.PeekMessageW(ctypes.byref(_msg), None, 0, 0, 1):
        _user32.TranslateMessage(ctypes.byref(_msg))
        _user32.DispatchMessageW(ctypes.byref(_msg))
        n += 1


RUN_SECONDS = 14400
try:
    BASE = os.path.join(KD_HOME, "bridge")          # KD_HOME is set by the launcher script that install.ps1 writes
except NameError:
    BASE = os.path.join(os.environ["KD_HOME"], "bridge") if os.environ.get("KD_HOME") else None
if not BASE or not os.path.isdir(BASE):
    raise RuntimeError("KeyShot Director: start it through the launcher script (Scripts tab > KeyShot Director) "
                       "so it knows where it is installed.")
CMD = os.path.join(BASE, "cmd")
RESP = os.path.join(BASE, "resp")
SHOTS = os.path.join(BASE, "shots")
OPS_FILE = os.path.join(BASE, "cc_ops.py")
for d in (CMD, RESP, SHOTS):
    os.makedirs(d, exist_ok=True)


def heartbeat(state, extra=None):
    with open(os.path.join(BASE, "heartbeat.json"), "w") as f:
        json.dump({"t": time.time(), "state": state, "ops_loaded": _STATE["ops_mtime"],
                   "err": _STATE["err"], "pid": os.getpid()}, f)


def another_bridge_alive():
    """True when a bridge in a DIFFERENT KeyShot window is already running on this folder (two bridges would answer
    commands at random, possibly lighting the wrong scene)."""
    try:
        with open(os.path.join(BASE, "heartbeat.json"), "r") as f:
            h = json.load(f)
        return h.get("state") == "running" and time.time() - h.get("t", 0) < 6 and h.get("pid") not in (None, os.getpid())
    except Exception:
        return False


_STATE = {"ops_mtime": 0, "ops": {}, "err": None}
INITIAL = None


def load_ops():
    try:
        m = os.path.getmtime(OPS_FILE)
        if m == _STATE["ops_mtime"]:
            return
        with open(OPS_FILE, "r", encoding="utf-8-sig") as f:
            src = f.read()
        ns = {"lux": lux, "luxmath": luxmath, "os": os, "json": json, "time": time,
              "shutil": shutil, "math": math, "SHOTS": SHOTS, "BASE": BASE, "INITIAL": INITIAL}
        exec(compile(src, OPS_FILE, "exec"), ns)
        _STATE["ops"] = ns["OPS"]
        _STATE["ops_mtime"] = m
        _STATE["err"] = None
        _STATE["ns"] = ns
    except Exception:
        _STATE["err"] = traceback.format_exc()
        _STATE["ops_mtime"] = os.path.getmtime(OPS_FILE) if os.path.exists(OPS_FILE) else 0


def handle(path):
    cid = os.path.splitext(os.path.basename(path))[0]
    stop = False
    # Claim the command with an atomic rename. If another bridge (another KeyShot window) or the sender still has the file
    # open, the rename fails or loses the race: then it is simply not ours - skip it quietly instead of erroring.
    claim = path + ".run%d" % os.getpid()
    try:
        os.replace(path, claim)
    except OSError:
        return False
    try:
        with open(claim, "r", encoding="utf-8-sig") as f:
            c = json.load(f)
        for _ in range(10):                       # antivirus / sync tools can briefly hold the file
            try:
                os.remove(claim)
                break
            except OSError:
                time.sleep(0.03)
        path = claim
        t0 = time.time()
        out = _STATE["ops"][c["op"]](c)
        resp = {"ok": True, "result": out, "secs": round(time.time() - t0, 4)}
        stop = c["op"] == "stop"
    except Exception:
        resp = {"ok": False, "error": traceback.format_exc()}
        try:
            os.remove(path)
        except Exception:
            pass
    with open(os.path.join(RESP, cid + ".json"), "w", encoding="utf-8") as f:
        json.dump(resp, f, default=str)
    return stop


def main():
    global INITIAL
    if another_bridge_alive():
        print("KeyShot Director: another KeyShot window already has the bridge running. Use that one, or close it first. "
              "This window was NOT connected.")
        return
    load_ops()
    try:
        INITIAL = _STATE["ns"]["read_camera"]()
        _STATE["ns"]["INITIAL"] = INITIAL
        _STATE["ops_mtime"] = 0      # force reload so ops see INITIAL
        load_ops()
    except Exception:
        INITIAL = None
    with open(os.path.join(BASE, "initial_camera.json"), "w") as f:
        json.dump(INITIAL, f, default=str)
    print("cc_bridge v2: running up to %ds. Op 'stop' ends it." % RUN_SECONDS)
    end = time.time() + RUN_SECONDS
    stop = False
    last_hb = 0
    try:
        while time.time() < end and not stop:
            pump()
            if time.time() - last_hb > 1:
                load_ops()
                heartbeat("running")
                last_hb = time.time()
            for fn in sorted(os.listdir(CMD)):
                if fn.endswith(".json"):                # (claimed files end in .json.run<pid> and are never picked up twice)
                    if handle(os.path.join(CMD, fn)):
                        stop = True
                        break
            pump()
            time.sleep(0.01)
    finally:
        heartbeat("stopped")
        print("cc_bridge v2: finished")


main()
