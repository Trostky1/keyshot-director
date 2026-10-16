# Material operations run inside KeyShot. New generated materials are unassigned;
# a library-material copy is applied only to the explicitly selected geometry.
MATERIAL_UNDO = []
_CREATED_REGISTRY = os.path.join(BASE, "director-created-materials.json")
_COPY_REGISTRY = os.path.join(BASE, "director-material-copies.json")
try:
    with open(_CREATED_REGISTRY, "r", encoding="utf-8-sig") as _registry_file:
        MATERIAL_CREATED = set(str(x) for x in json.load(_registry_file) if isinstance(x, str))
except Exception:
    MATERIAL_CREATED = set()
try:
    with open(_COPY_REGISTRY, "r", encoding="utf-8-sig") as _copy_registry_file:
        MATERIAL_COPIES = set(str(x) for x in json.load(_copy_registry_file) if isinstance(x, str))
except Exception:
    MATERIAL_COPIES = set()
MATERIAL_EDIT_TARGET = None
DISPLACEMENT_HEIGHT_MIN_MM = 0.001
DISPLACEMENT_HEIGHT_DEFAULT_MM = 0.01
DISPLACEMENT_HEIGHT_MAX_MM = 0.1


def _assignment(object_id):
    value = lux.getObjectMaterial(object_id)
    if value is None or value == "" or value == [] or value == ():
        raise ValueError("Original material assignment cannot be read safely")
    return str(value[0] if isinstance(value, (list, tuple)) and value else value)


def _assignment_guard(operation):
    def guarded(c):
        object_id = int(c.get("object_id"))
        before = _assignment(object_id)
        prior_receipts = list(MATERIAL_UNDO)
        try:
            return operation(c)
        except Exception as error:
            try:
                lux.setObjectMaterial(before, object_id, link=True)
                lux.sync()
                if _assignment(object_id) != before:
                    raise RuntimeError("restored assignment readback differs")
                MATERIAL_UNDO[:] = prior_receipts
            except Exception as recovery_error:
                raise RuntimeError("Material copy failed; assignment recovery could not be verified: " + str(recovery_error)) from error
            raise
    return guarded


def _remember_material_edit(receipt):
    receipt["scene_identity"] = _material_scene_identity()
    MATERIAL_UNDO.append(receipt)
    if len(MATERIAL_UNDO) > 20:
        MATERIAL_UNDO.pop(0)
    return {k: v for k, v in receipt.items() if k != "restore"}


def _material_scene_identity():
    try:
        info = lux.getSceneInfo()
        filename = str(info.get("file", "") or "").strip()
        if not filename:
            return None
        return {"file": os.path.normcase(os.path.abspath(filename)),
                "name": str(info.get("name", "") or ""),
                "unit": str(info.get("unit", "") or ""),
                "unit_scale": info.get("unitScale"), "root_id": lux.getSceneTree().getID()}
    except Exception:
        return None


def _save_created_registry():
    tmp = _CREATED_REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(MATERIAL_CREATED), f, ensure_ascii=False)
    os.replace(tmp, _CREATED_REGISTRY)


def _save_copy_registry():
    tmp = _COPY_REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(MATERIAL_COPIES), f, ensure_ascii=False)
    os.replace(tmp, _COPY_REGISTRY)


def _material_names():
    return sorted(set(str(x) for x in lux.getSceneMaterials() if x) | MATERIAL_CREATED)


def _material_graph(name):
    if name not in _material_names():
        raise ValueError("Material is not in the current scene")
    return lux.getMaterialGraph(name)


def _material_node_type(node):
    try:
        type_info = node.getType()
        return str(type_info.get("name") if isinstance(type_info, dict) else type_info)
    except Exception:
        return ""


def _parameter_value(p):
    try:
        v = p.getValue()
        if isinstance(v, (bool, int, float, str)):
            return v
        if isinstance(v, (tuple, list)):
            return list(v)
        return str(v)
    except Exception:
        return None  # connected shader inputs have no independent concrete value


def op_materials_list(c):
    return {"materials": _material_names(), "editable_target": MATERIAL_EDIT_TARGET}


def op_material_library(c):
    """Return names from KeyShot's loaded material library for browsing/copying."""
    query = str(c.get("query", "")).strip().lower()
    materials = sorted(set(str(x) for x in lux.getLibraryMaterials() if x))
    if query:
        materials = [name for name in materials if query in name.lower()]
    return {"materials": materials[:2000], "total": len(materials)}


def op_material_scene_objects(c):
    """List leaf geometry eligible for one-part library material assignment."""
    geometry_ids = set(lux.getObjects())
    out = []
    for node in lux.getSceneTree().find(""):
        try:
            if node.isDeleted() or node.isHidden() or node.isLocked() or node.isCamera() or node.isAnimation():
                continue
            if node.getID() not in geometry_ids:
                continue
            parent = node.getParent()
            blocked = False
            while parent and parent.getID() != lux.getSceneTree().getID():
                if parent.isLocked() or parent.isHidden() or parent.getName().startswith("CC_L_"):
                    blocked = True
                    break
                parent = parent.getParent()
            if blocked:
                continue
            material = lux.getObjectMaterial(node.getID())
            material = material[0] if isinstance(material, (list, tuple)) and material else material
            out.append({"node_id": node.getID(), "name": node.getName()[:160], "material": str(material)})
        except Exception:
            continue
    return {"objects": out}


@_assignment_guard
def op_material_library_copy(c):
    """Copy a library material directly onto one selected object, without editing the library entry."""
    global MATERIAL_EDIT_TARGET
    source = str(c.get("source", ""))
    label = str(c.get("name", "Director Library Copy")).strip()
    try:
        object_id = int(c.get("object_id"))
    except (TypeError, ValueError):
        raise ValueError("Choose a scene part to receive this material copy")
    if source not in [str(x) for x in lux.getLibraryMaterials() if x]:
        raise ValueError("Choose a material from the loaded KeyShot library")
    if not label.startswith("Director ") or len(label) > 80 or len(label) < 12:
        raise ValueError("Use a descriptive copy label beginning with 'Director ' (12–80 characters)")
    node = next((n for n in lux.getSceneTree().find("") if n.getID() == object_id), None)
    if node is None or node.isDeleted() or node.getID() not in set(lux.getObjects()) or node.isLocked() or node.isHidden():
        raise ValueError("Choose an unlocked scene object")
    parent = node.getParent()
    root_id = lux.getSceneTree().getID()
    while parent and parent.getID() != root_id:
        if parent.isLocked() or parent.isHidden():
            raise ValueError("The selected part belongs to a hidden or locked assembly")
        parent = parent.getParent()
    before_assignment = _assignment(object_id)
    lux.setObjectMaterial(source, object_id, link=False)
    copied = lux.getObjectMaterial(object_id)
    copied = copied[0] if isinstance(copied, (list, tuple)) and copied else copied
    copied = str(copied)
    if not copied or copied == source:
        raise RuntimeError("KeyShot did not create an independent scene copy")
    _remember_material_edit({"kind": "assignment", "name": copied, "object_id": object_id,
                             "before": before_assignment, "after": copied})
    if copied in _material_names() and copied not in MATERIAL_CREATED:
        copied = ""
        for candidate in lux.getSceneMaterials():
            candidate = str(candidate)
            if candidate and candidate != source and candidate not in MATERIAL_CREATED:
                try:
                    assigned = lux.getObjectMaterial(object_id)
                    assigned = assigned[0] if isinstance(assigned, (list, tuple)) and assigned else assigned
                    if str(assigned) == candidate:
                        copied = candidate
                        break
                except Exception:
                    continue
        if not copied:
            raise RuntimeError("KeyShot did not expose the independent material instance name")
    MATERIAL_CREATED.add(copied)
    MATERIAL_COPIES.add(copied)
    MATERIAL_EDIT_TARGET = None
    _save_created_registry()
    _save_copy_registry()
    lux.sync()
    result = op_material_inspect({"name": copied})
    result.update({"source": source, "object_id": object_id, "requested_label": label,
                   "replaced_material": str(before_assignment) if before_assignment is not None else None,
                   "independent_copy": True})
    return result


def op_material_targets(c):
    """List valid objects currently using a material, for copy-first editing."""
    source = str(c.get("source", ""))
    if source not in [str(x) for x in lux.getSceneMaterials() if x]:
        return {"objects": []}
    geometry_ids = set(lux.getObjects())
    out = []
    for node in lux.getSceneTree().find(""):
        try:
            if node.isDeleted() or node.getID() not in geometry_ids or node.isLocked() or node.isHidden():
                continue
            parent = node.getParent()
            blocked = False
            while parent and parent.getID() != lux.getSceneTree().getID():
                if parent.isLocked() or parent.isHidden():
                    blocked = True
                    break
                parent = parent.getParent()
            if blocked:
                continue
            material = lux.getObjectMaterial(node.getID())
            material = material[0] if isinstance(material, (list, tuple)) and material else material
            if str(material) == source:
                out.append({"object_id": node.getID(), "name": node.getName()[:160], "material": source})
        except Exception:
            continue
    return {"objects": out}


def op_material_inspect(c):
    name = str(c.get("name", ""))
    g = _material_graph(name)
    edges = []
    incoming = {}
    seen_edges = set()
    for target in g.getNodes():
        try:
            for edge in target.getInputEdges():
                if edge.getID() in seen_edges:
                    continue
                seen_edges.add(edge.getID())
                source = edge.getSourceNode()
                target_param = None
                for param in target.getParameters():
                    try:
                        input_edge = target.getInputEdge(param.getName())
                        if input_edge is not None and input_edge.getID() == edge.getID():
                            target_param = param.getName()
                            break
                    except Exception:
                        continue
                edge_info = {"id": edge.getID(), "source_node_id": source.getID(),
                             "source_type": source.getType(), "target_node_id": target.getID(),
                             "target_type": target.getType(), "target_parameter": target_param,
                             "enabled": edge.isEnabled()}
                edges.append(edge_info)
                if target_param is not None:
                    incoming[(target.getID(), target_param)] = edge_info
        except Exception as e:
            edges.append({"target_node_id": target.getID(), "error": repr(e)})
    nodes = []
    for n in g.getNodes():
        params = []
        for p in n.getParameters():
            edge = incoming.get((n.getID(), p.getName()))
            params.append({"name": p.getName(), "type": p.getType(), "value": _parameter_value(p),
                           "connected": edge is not None,
                           "source_node_id": edge.get("source_node_id") if edge else None,
                           "source_type": edge.get("source_type") if edge else None})
        try:
            node_name = n.getName()
        except Exception:
            node_name = None
        nodes.append({"id": n.getID(), "name": node_name, "type": n.getType(), "parameters": params})
    created = name in MATERIAL_CREATED
    channels = []
    for socket, meaning in (("surface", "Surface shading"), ("labels", "Label shading and coverage"),
                            ("geometry", "Geometry processing; execution is a separate action")):
        try:
            edge = g.getRoot().getInputEdge(socket)
            source = edge.getSourceNode() if edge is not None else None
            channels.append({"socket": socket, "meaning": meaning, "source_node_id": source.getID() if source else None,
                             "source_type": source.getType() if source else None,
                             "enabled": edge.isEnabled() if edge is not None else None})
        except Exception as error:
            if "No input edge" in str(error):
                channels.append({"socket": socket, "meaning": meaning, "source_node_id": None,
                                 "source_type": None, "enabled": None})
            else:
                channels.append({"socket": socket, "meaning": meaning, "error": repr(error)})
    return {"name": name, "editable": created or name == MATERIAL_EDIT_TARGET,
            "director_created": created, "edit_enabled": name == MATERIAL_EDIT_TARGET,
            "nodes": nodes, "edges": edges, "root_channels": channels,
            "undo": {"available": bool(MATERIAL_UNDO), "scope": "Session only: value edits, copy assignments and supported map replacements. Geometry execution and saved files are excluded."}}


def op_material_edit_target(c):
    global MATERIAL_EDIT_TARGET
    name = str(c.get("name", ""))
    enabled = bool(c.get("enabled"))
    if enabled:
        if name not in [str(x) for x in lux.getSceneMaterials() if x]:
            raise ValueError("Choose a material currently assigned in the KeyShot scene")
        if name in MATERIAL_CREATED:
            raise ValueError("Director-created materials are already editable")
        MATERIAL_EDIT_TARGET = name
    elif MATERIAL_EDIT_TARGET == name:
        MATERIAL_EDIT_TARGET = None
    lux.sync()
    return {"name": name, "enabled": MATERIAL_EDIT_TARGET == name}


def op_material_create(c):
    global MATERIAL_EDIT_TARGET
    name = str(c.get("name", "")).strip()
    if not name.startswith("Director ") or len(name) > 80 or len(name) < 12:
        raise ValueError("Use a name beginning with 'Director ' (12–80 characters)")
    if name in _material_names():
        raise ValueError("A material with this name already exists")
    # KeyShot documents createSceneMaterial as a creation call, but does not
    # document a return value. Verify success from the resulting graph instead
    # of interpreting a version-dependent return value as a boolean.
    create_result = lux.createSceneMaterial(name)
    lux.sync()
    try:
        graph = lux.getMaterialGraph(name)
        if graph is None:
            raise RuntimeError("KeyShot returned no material graph")
        graph.getRoot()
        graph.getNodes()
    except Exception as error:
        raise RuntimeError(
            "KeyShot did not expose a usable graph for the new material "
            "(createSceneMaterial returned %r): %s" % (create_result, str(error)[:240]))
    MATERIAL_EDIT_TARGET = None
    MATERIAL_CREATED.add(name)
    _save_created_registry()
    return op_material_inspect({"name": name})


@_assignment_guard
def op_material_copy(c):
    """Make an independent scene-material copy on the selected object."""
    global MATERIAL_EDIT_TARGET
    source = str(c.get("source", ""))
    name = str(c.get("name", "")).strip()
    try:
        object_id = int(c.get("object_id"))
    except (TypeError, ValueError):
        raise ValueError("Choose a scene part that uses the source material")
    if source not in [str(x) for x in lux.getSceneMaterials() if x]:
        raise ValueError("The source must be a material currently used in the scene")
    if not name.startswith("Director ") or len(name) > 80 or len(name) < 12:
        raise ValueError("Use a descriptive copy label beginning with 'Director ' (12–80 characters)")
    node = next((n for n in lux.getSceneTree().find("") if n.getID() == object_id), None)
    if node is None or node.isDeleted() or node.getID() not in set(lux.getObjects()) or node.isLocked() or node.isHidden():
        raise ValueError("Choose a valid scene object that uses this material")
    parent = node.getParent()
    root_id = lux.getSceneTree().getID()
    while parent and parent.getID() != root_id:
        if parent.isLocked() or parent.isHidden():
            raise ValueError("The selected part belongs to a hidden or locked assembly")
        parent = parent.getParent()
    current = lux.getObjectMaterial(object_id)
    current = current[0] if isinstance(current, (list, tuple)) and current else current
    if str(current) != source:
        raise ValueError("That scene object no longer uses the selected source material; refresh and try again")
    lux.setObjectMaterial(source, object_id, link=False)
    copied = lux.getObjectMaterial(object_id)
    copied = copied[0] if isinstance(copied, (list, tuple)) and copied else copied
    copied = str(copied)
    if not copied or copied == source:
        raise RuntimeError("KeyShot did not return an independent material copy")
    _remember_material_edit({"kind": "assignment", "name": copied, "object_id": object_id,
                             "before": source, "after": copied})
    MATERIAL_CREATED.add(copied)
    MATERIAL_COPIES.add(copied)
    MATERIAL_EDIT_TARGET = None
    _save_created_registry()
    _save_copy_registry()
    lux.sync()
    result = op_material_inspect({"name": copied})
    result.update({"source": source, "object_id": object_id, "requested_label": name, "independent_copy": True})
    return result


def op_material_set(c):
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED and name != MATERIAL_EDIT_TARGET:
        raise ValueError("Enable edits for this selected scene material first")
    g = _material_graph(name)
    node = next((n for n in g.getNodes() if n.getID() == int(c.get("node_id", -1))), None)
    if node is None:
        raise ValueError("Material node no longer exists")
    param = next((p for p in node.getParameters() if p.getName() == c.get("parameter")), None)
    if param is None:
        raise ValueError("Material parameter no longer exists")
    try:
        connected_edge = node.getInputEdge(param.getName())
    except Exception:
        connected_edge = None
    if connected_edge is not None:
        raise ValueError("This input is driven by a connected node; edit the source map or disconnect it first")
    old = _parameter_value(param)
    if "expected_value" in c and c["expected_value"] != old:
        raise ValueError("Material changed since inspection; refresh before editing")
    if old is None:
        raise ValueError("Connected shader input cannot be edited as a value")
    value = c.get("value")
    if isinstance(old, bool):
        if not isinstance(value, bool): raise ValueError("Expected true or false")
    elif isinstance(old, (int, float)):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError("Expected a finite number")
        if isinstance(old, int) and not float(value).is_integer():
            raise ValueError("Expected a whole number")
        value = int(value) if isinstance(old, int) else float(value)
    elif isinstance(old, list) and len(old) in (3, 4):
        if not isinstance(value, list) or len(value) != len(old) or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in value):
            raise ValueError("Expected a color array")
        value = tuple(float(x) for x in value)
    else:
        raise ValueError("This parameter type is not editable yet")
    receipt = None
    try:
        param.setValue(value)
        actual = _parameter_value(param)
        receipt = {"kind": "value", "name": name, "node_id": node.getID(),
                   "parameter": param.getName(), "before": old, "after": actual}
        _remember_material_edit(receipt)
        lux.sync()
        actual = _parameter_value(param)
        valid = (isinstance(actual, bool) if isinstance(old, bool) else
                 isinstance(actual, (int, float)) and not isinstance(actual, bool) and math.isfinite(actual)
                 if isinstance(old, (int, float)) else
                 isinstance(actual, list) and len(actual) == len(old) and
                 all(isinstance(item, (int, float)) and math.isfinite(item) for item in actual))
        if not valid:
            raise RuntimeError("KeyShot did not provide a valid material value after synchronization")
        receipt["after"] = actual
    except Exception as error:
        try:
            param.setValue(tuple(old) if isinstance(old, list) else old)
            lux.sync()
            if _parameter_value(param) != old:
                raise RuntimeError("restored value readback differs")
            if receipt is not None and MATERIAL_UNDO and MATERIAL_UNDO[-1] is receipt:
                MATERIAL_UNDO.pop()
        except Exception as recovery_error:
            raise RuntimeError("Material edit failed; value recovery could not be verified: " + str(recovery_error)) from error
        raise
    return {"name": name, "node_id": node.getID(), "parameter": param.getName(), "before": old, "after": actual}


def op_material_undo(c):
    if not MATERIAL_UNDO:
        raise ValueError("No Director material edit to undo")
    receipt = MATERIAL_UNDO[-1]
    identity = _material_scene_identity()
    if identity is None or receipt.get("scene_identity") is None or identity != receipt["scene_identity"]:
        raise ValueError("Scene identity changed or cannot be verified; undo refused and receipt retained")
    if receipt["kind"] == "assignment":
        object_id = receipt["object_id"]
        node = next((n for n in lux.getSceneTree().find("") if n.getID() == object_id), None)
        if node is None or node.isDeleted() or node.isLocked() or node.isHidden():
            raise ValueError("The assignment target is no longer available for undo")
        parent = node.getParent()
        root_id = lux.getSceneTree().getID()
        while parent and parent.getID() != root_id:
            if parent.isLocked() or parent.isHidden():
                raise ValueError("The assignment target belongs to a hidden or locked assembly")
            parent = parent.getParent()
        if _assignment(object_id) != receipt["after"]:
            raise ValueError("Material assignment changed outside this operation; undo refused")
        lux.setObjectMaterial(receipt["before"], object_id, link=True)
        lux.sync()
        if _assignment(object_id) != receipt["before"]:
            raise RuntimeError("KeyShot did not confirm restored assignment; receipt retained")
        MATERIAL_UNDO.pop()
        return {"name": receipt["before"], "parameter": "material assignment", "restored": receipt["before"]}
    if receipt["kind"] == "map":
        receipt["restore"]()
        MATERIAL_UNDO.pop()
        return {"name": receipt["name"], "parameter": receipt["parameter"], "restored": "previous map connection"}
    name, nid, pname, old = receipt["name"], receipt["node_id"], receipt["parameter"], receipt["before"]
    g = _material_graph(name)
    node = next((n for n in g.getNodes() if n.getID() == nid), None)
    if node is None: raise ValueError("Material node no longer exists")
    param = next((p for p in node.getParameters() if p.getName() == pname), None)
    if param is None: raise ValueError("Material parameter no longer exists")
    if node.getInputEdge(pname) is not None or _parameter_value(param) != receipt["after"]:
        raise ValueError("Material value changed outside this operation; undo refused")
    param.setValue(tuple(old) if isinstance(old, list) else old)
    lux.sync()
    if _parameter_value(param) != old:
        raise RuntimeError("KeyShot did not confirm restored value; receipt retained")
    MATERIAL_UNDO.pop()
    return {"name": name, "node_id": nid, "parameter": pname, "restored": old}


def op_material_save(c):
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED and name != MATERIAL_EDIT_TARGET:
        raise ValueError("Enable edits for the selected material before saving its package")
    _material_graph(name)
    folder = os.path.join(os.path.dirname(os.path.dirname(SHOTS)), "materials")
    if not os.path.isdir(folder): os.makedirs(folder)
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in name).strip()
    dst = os.path.join(folder, safe + ".kmp")
    if os.path.exists(dst):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dst = os.path.join(folder, safe + " " + stamp + ".kmp")
        revision = 2
        while os.path.exists(dst):
            dst = os.path.join(folder, safe + " " + stamp + " " + str(revision) + ".kmp")
            revision += 1
    library_folder = "Director"
    already_in_library = name in lux.getLibraryMaterials()
    library_saved = bool(lux.saveMaterial(name, library_folder))
    in_library_after_save = name in lux.getLibraryMaterials()
    if not library_saved and not already_in_library and not in_library_after_save:
        raise RuntimeError("KeyShot could not confirm this material in its Director library folder")
    package_result = lux.saveMaterialPackage(name, dst)
    # KeyShot scripting return values vary by release; the exported artifact is
    # the authoritative check. Reject absent and empty files, but don't treat a
    # false-like API return as failure when the package is actually complete.
    if not os.path.isfile(dst) or os.path.getsize(dst) <= 0:
        raise RuntimeError("KeyShot saved the library material but package export did not create a non-empty KMP")
    return {"name": name, "path": dst, "library": library_saved or already_in_library or in_library_after_save,
            "library_folder": library_folder, "package_bytes": os.path.getsize(dst),
            "package_api_result": package_result}


def op_material_discard(c):
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED:
        raise ValueError("Only a material created in this Director session can be discarded")
    if name in lux.getSceneMaterials():
        raise ValueError("This material is assigned to an object; remove it from the object in KeyShot first")
    lux.deleteMaterial(name)
    MATERIAL_CREATED.remove(name)
    if name in MATERIAL_COPIES:
        MATERIAL_COPIES.remove(name)
        _save_copy_registry()
    _save_created_registry()
    lux.sync()
    return {"discarded": name}


def _selected_geometry():
    root = lux.getSceneTree()
    geometry_ids = set(lux.getObjects())
    found = {}
    def walk(node):
        try:
            if node.isDeleted() or node.isHidden():
                return
        except Exception:
            pass
        oid = node.getID()
        nm = node.getName() or ''
        if oid in geometry_ids and not nm.startswith(('CC_L_', 'CC_S_')):
            found[oid] = nm
            return
        try:
            for child in node.getChildren():
                walk(child)
        except Exception:
            pass
    try:
        for node in root.getSelected():
            walk(node)
    except Exception:
        pass
    return [{'id': oid, 'name': found[oid]} for oid in sorted(found)]


def op_material_selection(c):
    objects = _selected_geometry()
    for obj in objects:
        try:
            material = lux.getObjectMaterial(obj['id'])
            if isinstance(material, (list, tuple)):
                material = material[0] if material else None
            obj['material'] = str(material or '')
        except Exception as e:
            obj['material_error'] = repr(e)
    return {'objects': objects}


def op_material_texture_apply(c):
    """Wire imported texture maps into a new Director material graph."""
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED:
        raise ValueError("Texture maps can only be wired to a Director-created material")
    root_dir = os.path.realpath(os.path.join(BASE, "..", "materials", "texture-sets"))
    requested = c.get("maps")
    if not isinstance(requested, list) or not requested or len(requested) > 8:
        raise ValueError("Provide one to eight supported texture maps")
    model = str(c.get("model", "Plastic"))
    if model != "Plastic":
        raise ValueError("Only the simple Plastic material workflow is enabled")
    tile_mm = c.get("tile_size_mm", 41.0)
    if isinstance(tile_mm, bool) or not isinstance(tile_mm, (int, float)) or not math.isfinite(tile_mm) or not 1.0 <= tile_mm <= 2000.0:
        raise ValueError("Texture tile size must be between 1 and 2000 mm")

    supported = {"base-color", "ambient-occlusion", "roughness", "normal", "bump"}
    clean = []
    roles = set()
    for item in requested:
        if not isinstance(item, dict):
            raise ValueError("Each texture map must include a supported role and imported file path")
        role = str(item.get("role", ""))
        if role not in supported or role in roles:
            raise ValueError("Unsupported or duplicate map role: " + role)
        file_path = os.path.realpath(str(item.get("path", "")))
        try:
            inside = os.path.commonpath((root_dir, file_path)) == root_dir
        except ValueError:
            inside = False
        if not inside or not os.path.isfile(file_path):
            raise ValueError("Texture map must be an existing file inside Director imported texture sets")
        roles.add(role)
        clean.append((role, file_path))
    if "normal" in roles and "bump" in roles:
        clean = [(role, file_path) for role, file_path in clean if role != "bump"]
        roles.remove("bump")
    if "ambient-occlusion" in roles and "base-color" not in roles:
        raise ValueError("AO needs a Base Color map for its Multiply composite")

    graph = _material_graph(name)
    root = graph.getRoot()
    surface_edge = root.getInputEdge("surface")
    if surface_edge is None:
        raise ValueError("Director material has no surface shader")
    original_shader = surface_edge.getSourceNode()
    # createSceneMaterial may populate its Diffuse shader with default input
    # connections. The material is created by Director immediately before this
    # operation, and the registry check above establishes ownership. Do not
    # mistake KeyShot's defaults for a previously edited material.
    original_type = _material_node_type(original_shader)
    if original_type != str(lux.SHADER_TYPE_DIFFUSE):
        raise ValueError("The new Director material has an unexpected surface shader: " + original_type)
    shader_key = "SHADER_TYPE_PLASTIC"
    shader_constant = getattr(lux, shader_key, None)
    if shader_constant is None:
        raise ValueError("KeyShot does not expose the requested " + model + " material node")
    shader = graph.newNode(shader_constant)
    if shader is None:
        raise RuntimeError("KeyShot could not create the requested material graph node")
    made = [shader]
    linked = []
    surface_switched = False
    try:
        map_nodes = {}
        for role, file_path in clean:
            node = graph.newNode(lux.SHADER_TYPE_TEXTURE_MAP)
            if node is None:
                raise RuntimeError("KeyShot could not create a Texture Map node")
            made.append(node)
            map_nodes[role] = node
            params = {parameter.getName(): parameter for parameter in node.getParameters()}
            texture = params.get("texture")
            if texture is None:
                raise RuntimeError("KeyShot Texture Map has no image-file input")
            texture.setValue(file_path)
            if "normal" in params:
                params["normal"].setValue(role == "normal")
            if "texture_use_srgb" in params:
                params["texture_use_srgb"].setValue(role == "base-color")
            if "texture_use_profile" in params:
                params["texture_use_profile"].setValue(False)
            if role == "normal" and "bump_height" in params:
                params["bump_height"].setValue(1.0)
            if "uv_mapping" not in params:
                raise RuntimeError("KeyShot Texture Map has no Mapping Type control")
            # Use direct physical-size mapping for the single simple graph.
            params["uv_mapping"].setValue(1)
            params["uv_scale_mode"].setValue(0)
            params["uv_scale_u"].setValue(float(tile_mm) / 1000.0)
            params["uv_scale_v"].setValue(float(tile_mm) / 1000.0)

        # Keep the imported Base Color map intact and blend optional AO before
        # the Plastic diffuse input.
        color_source = map_nodes.get("base-color")
        composite = None
        try:
            if "ambient-occlusion" in roles:
                composite = graph.newNode(lux.SHADER_TYPE_COLOR_COMPOSITE)
                if composite is None:
                    raise RuntimeError("KeyShot could not create a Color Composite node for AO")
                made.append(composite)
                composite_params = {parameter.getName(): parameter for parameter in composite.getParameters()}
                if not all(key in composite_params for key in ("source", "background", "blend_mode")):
                    raise RuntimeError("KeyShot Color Composite lacks the inputs needed for AO")
                composite_params["blend_mode"].setValue(1)
                graph.newEdge(color_source, composite, "background")
                graph.newEdge(map_nodes["ambient-occlusion"], composite, "source")

            for role in roles:
                node = map_nodes[role]
                if role == "ambient-occlusion":
                    linked.append({"role": role, "target": "diffuse via Color Composite Multiply",
                                   "node_id": node.getID(), "utility_node_id": composite.getID()})
                elif role == "base-color" and composite is not None:
                    linked.append({"role": role, "target": "diffuse via Color Composite Multiply", "node_id": node.getID()})
                elif role == "roughness":
                    utility = graph.newNode(lux.SHADER_TYPE_COLOR_TO_NUMBER)
                    if utility is None:
                        raise RuntimeError("KeyShot could not create Color To Number for Roughness")
                    made.append(utility)
                    utility_params = {parameter.getName(): parameter for parameter in utility.getParameters()}
                    if "input" not in utility_params:
                        raise RuntimeError("KeyShot Color To Number has no color input")
                    graph.newEdge(node, utility, "input")
                    graph.newEdge(utility, shader, "roughness")
                    linked.append({"role": role, "target": "surface roughness", "node_id": node.getID(),
                                   "utility_node_id": utility.getID(), "utility": "Color To Number"})
                elif role == "base-color":
                    graph.newEdge(node, shader, "diffuse")
                    linked.append({"role": role, "target": "surface diffuse", "node_id": node.getID()})
                elif role != "ambient-occlusion":
                    graph.newEdge(node, shader, "bumpmap")
                    linked.append({"role": role, "target": "surface bump", "node_id": node.getID()})

            if composite is not None:
                graph.newEdge(composite, shader, "diffuse")
        except Exception:
            if composite is not None:
                try: graph.removeNode(composite)
                except Exception: pass
            raise

        graph.removeEdge(surface_edge)
        try:
            graph.newEdge(shader, root, "surface")
            surface_switched = True
        except Exception:
            graph.newEdge(original_shader, root, "surface")
            raise
        lux.sync()
        if root.getInputEdge("surface").getSourceNode().getID() != shader.getID():
            raise RuntimeError("KeyShot did not retain the surface connection")
        try:
            graph.removeNode(original_shader)
        except Exception:
            pass
    except Exception:
        if surface_switched:
            try:
                current_surface = root.getInputEdge("surface")
                if current_surface is not None:
                    graph.removeEdge(current_surface)
                graph.newEdge(original_shader, root, "surface")
            except Exception:
                pass
        for node in reversed(made):
            try:
                graph.removeNode(node)
            except Exception:
                pass
        try:
            lux.sync()
        except Exception:
            pass
        raise
    return {"name": name, "model": model, "maps": linked, "shared_mapping": False,
            "tile_size_mm": tile_mm,
            "note": "Material is unassigned; source maps and product parts remain unchanged."}


def op_material_execute_geometry(c):
    """Execute the KeyShot geometry graph for a material after it is assigned."""
    name = str(c.get("name", ""))
    if not name.startswith("Director "):
        raise ValueError("Geometry execution is limited to Director-created materials")
    graph = _material_graph(name)
    nodes = graph.getNodes()
    root = graph.getRoot()
    geometry_edge = root.getInputEdge("geometry")
    if geometry_edge is None:
        raise ValueError("This material has no node connected to root Geometry. Label bump/opacity and surface bump maps are not geometric displacement.")
    geometry_node = geometry_edge.getSourceNode()
    if "displace" not in _material_node_type(geometry_node).lower():
        raise ValueError("Root Geometry must be driven by a Displace node; label, opacity, normal, and surface bump branches do not qualify.")
    displacement_input = geometry_node.getInputEdge("displace")
    if displacement_input is None:
        raise ValueError("The root Geometry Displace node has no connected height input.")
    displacement_nodes = [node for node in nodes if "displace" in _material_node_type(node).lower()]
    if len(displacement_nodes) != 1 or displacement_nodes[0].getID() != geometry_node.getID():
        raise ValueError("This material must have exactly one Displace node, connected directly to root Geometry, before Director can execute it safely.")
    parameters = {parameter.getName(): parameter for parameter in geometry_node.getParameters()}
    height_parameter = parameters.get("displacement height")
    try:
        height_native = float(height_parameter.getValue()) if height_parameter is not None else None
    except Exception:
        height_native = None
    if height_native is None or not math.isfinite(height_native):
        raise ValueError("Could not read a finite Displacement Height from the connected geometry node.")
    height_mm = height_native * 1000.0
    if abs(height_mm) > DISPLACEMENT_HEIGHT_MAX_MM + 1e-9:
        raise ValueError("This material's displacement exceeds the safe 0.1 mm limit. Lower its Displacement Height before executing geometry.")

    assigned = []
    geometry_ids = set(lux.getObjects())
    scene_root_id = lux.getSceneTree().getID()
    for node in lux.getSceneTree().find(""):
        try:
            object_id = node.getID()
            if object_id not in geometry_ids or node.isDeleted():
                continue
            current = lux.getObjectMaterial(object_id)
            current = current[0] if isinstance(current, (list, tuple)) and current else current
            if str(current) == name:
                ancestor_hidden = False
                ancestor_locked = False
                parent = node.getParent()
                while parent and parent.getID() != scene_root_id:
                    ancestor_hidden = ancestor_hidden or bool(parent.isHidden())
                    ancestor_locked = ancestor_locked or bool(parent.isLocked())
                    if ancestor_hidden and ancestor_locked:
                        break
                    parent = parent.getParent()
                assigned.append({"object_id": object_id, "name": node.getName()[:160],
                                 "hidden": bool(node.isHidden() or ancestor_hidden),
                                 "locked": bool(node.isLocked() or ancestor_locked)})
        except Exception:
            continue
    if not assigned:
        raise ValueError("Assign this material to the intended product part in KeyShot first, then ask Director to execute its geometry.")
    if len(assigned) != 1:
        names = ", ".join(item["name"] for item in assigned[:8])
        raise ValueError("This material is assigned to multiple scene parts (" + names + "). Make a separate material copy for one intended part before executing geometry.")
    if assigned[0]["hidden"] or assigned[0]["locked"]:
        raise ValueError("The assigned product part must be visible and unlocked before its geometry can be executed.")
    execute = getattr(graph, "executeGeometryNodes", None)
    if not callable(execute):
        raise RuntimeError("This KeyShot scripting build does not expose MaterialGraph.executeGeometryNodes")
    execute()
    lux.sync()
    return {"name": name, "executed": True, "displacement_nodes": len(displacement_nodes),
            "displacement_height_mm": height_mm, "geometry_node_id": geometry_node.getID(),
            "assigned_objects": assigned,
            "note": "Preflight verified one Displace node connected to root Geometry; label, opacity, and surface bump branches were not used as geometry inputs."}

def _material_input_name(node, edge):
    for param in node.getParameters():
        try:
            linked = node.getInputEdge(param.getName())
            if linked is not None and linked.getID() == edge.getID():
                return param.getName()
        except Exception:
            continue
    return None


def _copy_material_subgraph(source_graph, source_output, target_graph, created):
    """Copy a connected procedural input branch by recreating its nodes and edges."""
    aliases = {
        "lux_color_blend": "SHADER_TYPE_COLOR_COMPOSITE",
        "lux_curvature": "SHADER_TYPE_CURVATURE",
        "lux_displace": "SHADER_TYPE_DISPLACE",
        "lux_spots": "SHADER_TYPE_SPOTS",
        "lux_scratches_worley": "SHADER_TYPE_SCRATCHES",
    }
    copied = {}

    def clone(node):
        source_id = node.getID()
        if source_id in copied:
            return copied[source_id]
        node_type = node.getType().get("name")
        constant_name = aliases.get(node_type)
        if not constant_name:
            raise ValueError("The geometry template contains an unsupported node: " + str(node_type))
        shader_type = getattr(lux, constant_name, None)
        if shader_type is None:
            raise ValueError("KeyShot does not expose the node required to copy " + str(node_type))
        new_node = target_graph.newNode(shader_type)
        if new_node is None:
            raise RuntimeError("KeyShot could not create the " + str(node_type) + " geometry node")
        created.append(new_node)
        copied[source_id] = new_node
        try:
            label = node.getName()
            if label:
                new_node.setName("Director Relief " + label[:80])
        except Exception:
            pass

        source_params = {p.getName(): p for p in node.getParameters()}
        target_params = {p.getName(): p for p in new_node.getParameters()}
        for key, source_param in source_params.items():
            if key not in target_params:
                continue
            try:
                if node.getInputEdge(key) is not None or source_param.isPure():
                    continue
            except Exception:
                pass
            try:
                value = source_param.getValue()
                if value is not None:
                    target_params[key].setValue(value)
            except Exception:
                # Keep KeyShot's default for unsupported concrete parameter types.
                continue

        for edge in node.getInputEdges():
            input_name = _material_input_name(node, edge)
            if not input_name or input_name not in target_params:
                continue
            source_node = clone(edge.getSourceNode())
            target_graph.newEdge(source_node, new_node, input_name)
        return new_node

    return clone(source_output)


def op_material_add_geometry_template(c):
    """Layer a template's procedural geometry relief over an imported displacement map."""
    name = str(c.get("name", ""))
    template_name = str(c.get("template", "Advanced Plastic #2"))
    if name not in MATERIAL_CREATED:
        raise ValueError("Procedural displacement can only be added to a new Director material")
    if template_name not in _material_names() or template_name == name:
        raise ValueError("Load the Advanced Plastic template into the current KeyShot scene first")

    target_graph = _material_graph(name)
    template_graph = _material_graph(template_name)
    target_root = target_graph.getRoot()
    template_root = template_graph.getRoot()
    target_geometry_edge = target_root.getInputEdge("geometry")
    template_geometry_edge = template_root.getInputEdge("geometry")
    if target_geometry_edge is None:
        raise ValueError("The new material needs a displacement map before procedural relief can be added")
    if template_geometry_edge is None:
        raise ValueError("The selected template has no geometry displacement branch")

    target_displace = target_geometry_edge.getSourceNode()
    template_displace = template_geometry_edge.getSourceNode()
    if target_displace.getType().get("name") != "lux_displace" or template_displace.getType().get("name") != "lux_displace":
        raise ValueError("Both materials need a KeyShot Displace node on their geometry input")
    map_edge = target_displace.getInputEdge("displace")
    procedural_edge = template_displace.getInputEdge("displace")
    if map_edge is None or procedural_edge is None:
        raise ValueError("The imported map or the template procedural relief is not connected")

    map_node = map_edge.getSourceNode()
    if map_node.getType().get("name") != "__texture":
        raise ValueError("The imported Displace node is not driven directly by a texture map")
    created = []
    composite = None
    original_edge_removed = False
    try:
        copied_procedural = _copy_material_subgraph(template_graph, procedural_edge.getSourceNode(), target_graph, created)
        composite = target_graph.newNode(lux.SHADER_TYPE_COLOR_COMPOSITE)
        if composite is None:
            raise RuntimeError("KeyShot could not create a displacement blend node")
        created.append(composite)
        params = {p.getName(): p for p in composite.getParameters()}
        for key in ("source", "background", "blend_mode", "alpha"):
            if key not in params:
                raise RuntimeError("KeyShot Color Composite lacks the " + key + " input")
        params["blend_mode"].setValue(3)  # Match the procedural blend mode in the Advanced Plastic template.
        params["alpha"].setValue(float(c.get("procedural_strength", 0.2)))
        target_graph.newEdge(copied_procedural, composite, "source")
        target_graph.newEdge(map_node, composite, "background")
        target_graph.removeEdge(map_edge)
        original_edge_removed = True
        target_graph.newEdge(composite, target_displace, "displace")
        lux.sync()
    except Exception:
        try:
            if original_edge_removed:
                current = target_displace.getInputEdge("displace")
                if current is not None:
                    target_graph.removeEdge(current)
                target_graph.newEdge(map_node, target_displace, "displace")
            for node in reversed(created):
                try:
                    target_graph.removeNode(node)
                except Exception:
                    pass
            lux.sync()
        except Exception:
            pass
        raise

    return {"name": name, "template": template_name, "source_map_node_id": map_node.getID(),
            "procedural_node_id": copied_procedural.getID(), "blend_node_id": composite.getID(),
            "displace_node_id": target_displace.getID(), "procedural_strength": float(c.get("procedural_strength", 0.2)),
            "geometry": "Imported displacement remains connected; template relief is blended into its height signal.",
            "note": "Unassigned Director material only; source template and imported map files are unchanged."}


def op_material_bump_set(c):
    """Replace supported image inputs on an independent Director copy only."""
    name = str(c.get("name", ""))
    if name not in MATERIAL_COPIES:
        raise ValueError("Bump editing is available only on an independent material copy created from the copy editor")
    map_path = c.get("path")
    strength = c.get("strength")
    role = str(c.get("role", "bump"))
    targets = {"bump": "bumpmap", "normal": "bumpmap", "base-color": "diffuse", "roughness": "roughness"}
    if role not in targets:
        raise ValueError("Supported image roles are Base Color, Roughness, Bump and Normal")
    if map_path is None and strength is None:
        raise ValueError("Provide an image file, a bump strength, or both")
    path = None
    if map_path is not None:
        root_dir = os.path.realpath(os.path.join(BASE, "..", "materials", "texture-sets"))
        path = os.path.realpath(str(map_path))
        if os.path.commonpath((root_dir, path)) != root_dir or not os.path.isfile(path):
            raise ValueError("Bump map must be an imported file inside Director's texture sets")
    if strength is not None and (isinstance(strength, bool) or not isinstance(strength, (int, float)) or not math.isfinite(strength)):
        raise ValueError("Bump strength must be a finite number")
    if strength is not None and role not in ("bump", "normal"):
        raise ValueError("Bump strength can only be set with the Bump or Normal channel")

    g = _material_graph(name)
    root = g.getRoot()
    surface_edge = root.getInputEdge("surface")
    if surface_edge is None:
        raise ValueError("Material has no surface shader")
    shader = surface_edge.getSourceNode()
    params = {p.getName(): p for p in shader.getParameters()}
    target_input = targets[role]
    if target_input not in params:
        raise ValueError("This material shader does not expose the " + role + " input")
    if map_path is not None:
        try:
            if params[target_input].isPure():
                raise ValueError("This shader exposes a nested input; direct image-map replacement is unsupported for this material type")
        except AttributeError:
            pass
    prior_edge = shader.getInputEdge(target_input)
    prior_source_id = prior_edge.getSourceNode().getID() if prior_edge is not None else None
    prior_enabled = prior_edge.isEnabled() if prior_edge is not None else None
    if prior_enabled is False:
        raise ValueError("Disabled map connections cannot be safely replaced by Director yet")
    prior_strength = next((p for p in shader.getParameters() if p.getName() in ("bump_height", "bump_scale", "bump_strength")), None)
    old_strength = _parameter_value(prior_strength) if prior_strength else None
    if strength is not None and prior_strength is None:
        raise ValueError("This shader does not expose a supported bump strength parameter")
    made = None
    converter = None
    removed = False
    try:
        if path is not None:
            made = g.newNode(lux.SHADER_TYPE_TEXTURE_MAP)
            if made is None:
                raise RuntimeError("KeyShot could not create a bump texture node")
            map_params = {p.getName(): p for p in made.getParameters()}
            if "texture" not in map_params:
                raise RuntimeError("KeyShot Texture Map has no image-file input")
            map_params["texture"].setValue(path)
            if role in ("base-color", "roughness"):
                if "color" not in map_params:
                    raise RuntimeError("KeyShot Texture Map has no color output for this channel")
                if role == "roughness":
                    converter = g.newNode(lux.SHADER_TYPE_COLOR_TO_NUMBER)
                    if converter is None:
                        raise RuntimeError("KeyShot could not create a Color To Number node for Roughness")
                    converter_params = {p.getName(): p for p in converter.getParameters()}
                    if "input" not in converter_params:
                        g.removeNode(converter)
                        converter = None
                        raise RuntimeError("KeyShot Color To Number has no color input")
                    g.newEdge(made, converter, "input")
            if "normal" in map_params:
                map_params["normal"].setValue(role == "normal")
            if "texture_use_srgb" in map_params:
                map_params["texture_use_srgb"].setValue(role == "base-color")
            for key in ("texture_use_profile",):
                if key in map_params:
                    map_params[key].setValue(False)
            if prior_edge is not None:
                g.removeEdge(prior_edge)
                removed = True
            if role == "roughness":
                g.newEdge(converter, shader, target_input)
            else:
                g.newEdge(made, shader, target_input)
        if strength is not None and prior_strength is not None:
            prior_strength.setValue(float(strength))
        lux.sync()
    except Exception:
        try:
            if converter is not None:
                g.removeNode(converter)
            if made is not None:
                edge = shader.getInputEdge(target_input)
                if edge is not None and edge.getSourceNode().getID() == made.getID():
                    g.removeEdge(edge)
                g.removeNode(made)
            if removed and prior_edge is not None:
                source = next((node for node in g.getNodes() if node.getID() == prior_source_id), None)
                if source is not None:
                    g.newEdge(source, shader, target_input)
            if prior_strength is not None and old_strength is not None:
                prior_strength.setValue(tuple(old_strength) if isinstance(old_strength, list) else old_strength)
            lux.sync()
        except Exception:
            pass
        raise
    expected_edge = shader.getInputEdge(target_input)
    expected_source_id = expected_edge.getSourceNode().getID() if expected_edge is not None else None
    expected_strength = _parameter_value(prior_strength) if prior_strength else None
    intended_source = converter if converter is not None else made
    if path is not None and (intended_source is None or expected_source_id != intended_source.getID()):
        raise RuntimeError("KeyShot did not confirm the requested map connection")
    shader_id = shader.getID()
    def restore_map():
        graph = _material_graph(name)
        nodes_by_id = {node.getID(): node for node in graph.getNodes()}
        target = nodes_by_id.get(shader_id)
        if target is None:
            raise ValueError("Map target no longer exists; undo refused")
        edge = target.getInputEdge(target_input)
        current_id = edge.getSourceNode().getID() if edge is not None else None
        strength_param = next((p for p in target.getParameters() if p.getName() in ("bump_height", "bump_scale", "bump_strength")), None)
        if current_id != expected_source_id or (strength_param is not None and _parameter_value(strength_param) != expected_strength):
            raise ValueError("Map or strength changed outside this operation; undo refused")
        if edge is not None and not edge.isEnabled():
            raise ValueError("Map connection was disabled outside this operation; undo refused")
        original = nodes_by_id.get(prior_source_id) if prior_source_id is not None else None
        if prior_source_id is not None and original is None:
            raise ValueError("Original map source no longer exists; undo refused")
        if path is not None:
            if edge is not None:
                graph.removeEdge(edge)
            if original is not None:
                graph.newEdge(original, target, target_input)
        if strength_param is not None and old_strength is not None:
            strength_param.setValue(tuple(old_strength) if isinstance(old_strength, list) else old_strength)
        lux.sync()
        restored_edge = target.getInputEdge(target_input)
        restored_id = restored_edge.getSourceNode().getID() if restored_edge is not None else None
        if restored_id != prior_source_id or (strength_param is not None and _parameter_value(strength_param) != old_strength):
            raise RuntimeError("KeyShot did not confirm restored map; receipt retained")
        # Retain disconnected nodes: another branch may now reference them.
    receipt = _remember_material_edit({"kind": "map", "name": name, "parameter": role,
                                       "before": {"source_node_id": prior_source_id, "strength": old_strength},
                                       "after": {"source_node_id": expected_source_id, "strength": expected_strength},
                                       "restore": restore_map})
    return {"name": name, "map": path, "role": role, "receipt": receipt, "strength": _parameter_value(prior_strength) if prior_strength else None,
            "note": "Only the independent Director copy was changed; the source material was not modified."}


MATERIAL_OPS = {"materials_list": op_materials_list, "material_inspect": op_material_inspect,
                "material_targets": op_material_targets,
                "material_create": op_material_create, "material_edit_target": op_material_edit_target,
                "material_set": op_material_set,
                "material_undo": op_material_undo, "material_save": op_material_save,
                "material_discard": op_material_discard,
                "material_texture_apply": op_material_texture_apply}
MATERIAL_OPS["material_copy"] = op_material_copy
MATERIAL_OPS["material_bump_set"] = op_material_bump_set
MATERIAL_OPS["material_library"] = op_material_library
MATERIAL_OPS["material_library_copy"] = op_material_library_copy
MATERIAL_OPS["material_scene_objects"] = op_material_scene_objects
