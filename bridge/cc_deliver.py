# cc_deliver.py - explicit native delivery (BIP scene / KSP package). Exec-loaded into cc_ops' namespace.
# SOURCE-CONFIRMED ONLY: lux.saveFile and lux.savePackage are documented in KeyShot's 2026.1 scripting reference, but this
# operation has not been run in KeyShot. It never runs as part of a fit; the server calls it only for an explicit user request.
import os


def _scene_file():
    """Full path KeyShot reports for the open scene ('' when unsaved)."""
    try:
        info = lux.getSceneInfo()
        return str(info.get("file", "") or "") if isinstance(info, dict) else ""
    except Exception:
        return ""


def _same_path(a, b):
    return bool(a) and bool(b) and os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def _check_target(kind, ext, path, current):
    if not isinstance(path, str) or not path or "\0" in path or len(path) > 400:
        raise ValueError("%s needs a file path" % kind)
    if not os.path.isabs(path) or os.path.splitext(path)[1].lower() != ext:
        raise ValueError("%s path must be absolute and end in %s" % (kind, ext))
    folder = os.path.dirname(path)
    if not os.path.isdir(folder):
        raise ValueError("the destination folder for %s does not exist" % kind)
    if os.path.exists(path):
        raise ValueError("%s already exists; Director never overwrites a scene file" % path)
    if _same_path(path, current):
        raise ValueError("refusing to write over the currently open scene file")


def op_scene_save(c):
    """Save the open scene as a new BIP (lux.saveFile) and/or a new KSP package (lux.savePackage).

    The KSP is written first: saveFile can behave like Save As and retarget the open document, and the package should be
    made from the document as it was. The result reports whether KeyShot's open scene file changed."""
    unknown = set(c) - {"op", "bip", "ksp"}
    if unknown:
        raise ValueError("unsupported scene_save input: %s" % sorted(unknown)[0])
    bip, ksp = c.get("bip"), c.get("ksp")
    if not bip and not ksp:
        raise ValueError("choose a bip path, a ksp path, or both")
    before = _scene_file()
    if bip:
        _check_target("bip", ".bip", bip, before)
    if ksp:
        _check_target("ksp", ".ksp", ksp, before)
    written = {}
    if ksp:
        lux.savePackage(ksp)
        written["ksp"] = ksp
    if bip:
        lux.saveFile(bip)
        written["bip"] = bip
    files = {}
    for kind, path in written.items():
        size = os.path.getsize(path) if os.path.isfile(path) else 0
        if size <= 0:
            raise RuntimeError("KeyShot did not write a non-empty %s file at the requested path" % kind)
        files[kind] = {"path": path, "bytes": size}
    after = _scene_file()
    return {"saved": list(written), "files": files, "scene_file_before": os.path.basename(before) if before else None,
            "scene_file_after": os.path.basename(after) if after else None, "open_scene_retargeted": not _same_path(before, after) and before != after,
            "note": "Saved through documented lux.saveFile/savePackage; reopening the result in a clean session has not been verified."}


DELIVER_OPS = {"scene_save": op_scene_save}
