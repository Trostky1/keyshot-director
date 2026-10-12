# Material operations run inside KeyShot. New materials are deliberately unassigned:
# the artist can drag them onto parts after inspecting the result.
MATERIAL_UNDO = []
_CREATED_REGISTRY = os.path.join(BASE, "director-created-materials.json")
try:
    with open(_CREATED_REGISTRY, "r", encoding="utf-8-sig") as _registry_file:
        MATERIAL_CREATED = set(str(x) for x in json.load(_registry_file) if isinstance(x, str))
except Exception:
    MATERIAL_CREATED = set()
MATERIAL_EDIT_TARGET = None


def _save_created_registry():
    tmp = _CREATED_REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(MATERIAL_CREATED), f, ensure_ascii=False)
    os.replace(tmp, _CREATED_REGISTRY)


def _material_names():
    return sorted(set(str(x) for x in lux.getSceneMaterials() if x) | MATERIAL_CREATED)


def _material_graph(name):
    if name not in _material_names():
        raise ValueError("Material is not in the current scene")
    return lux.getMaterialGraph(name)


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
        nodes.append({"id": n.getID(), "type": n.getType(), "parameters": params})
    created = name in MATERIAL_CREATED
    return {"name": name, "editable": created or name == MATERIAL_EDIT_TARGET,
            "director_created": created, "edit_enabled": name == MATERIAL_EDIT_TARGET,
            "nodes": nodes, "edges": edges}


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
    if not lux.createSceneMaterial(name):
        raise RuntimeError("KeyShot could not create the material")
    MATERIAL_EDIT_TARGET = None
    MATERIAL_CREATED.add(name)
    _save_created_registry()
    lux.sync()
    return op_material_inspect({"name": name})


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
    param.setValue(value)
    lux.sync()
    MATERIAL_UNDO.append((name, node.getID(), param.getName(), old))
    if len(MATERIAL_UNDO) > 20: MATERIAL_UNDO.pop(0)
    return {"name": name, "node_id": node.getID(), "parameter": param.getName(), "before": old, "after": _parameter_value(param)}


def op_material_undo(c):
    if not MATERIAL_UNDO:
        raise ValueError("No Director material edit to undo")
    name, nid, pname, old = MATERIAL_UNDO[-1]
    g = _material_graph(name)
    node = next((n for n in g.getNodes() if n.getID() == nid), None)
    if node is None: raise ValueError("Material node no longer exists")
    param = next((p for p in node.getParameters() if p.getName() == pname), None)
    if param is None: raise ValueError("Material parameter no longer exists")
    param.setValue(tuple(old) if isinstance(old, list) else old)
    lux.sync()
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
    already_in_library = name in lux.getLibraryMaterials()
    library_saved = bool(lux.saveMaterial(name, "Director"))
    if not library_saved and not already_in_library:
        raise RuntimeError("KeyShot could not save the material to its library")
    if not lux.saveMaterialPackage(name, dst) or not os.path.isfile(dst):
        raise RuntimeError("KeyShot saved the library material but package export failed")
    return {"name": name, "path": dst, "library": library_saved or already_in_library}


def op_material_discard(c):
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED:
        raise ValueError("Only a material created in this Director session can be discarded")
    if name in lux.getSceneMaterials():
        raise ValueError("This material is assigned to an object; remove it from the object in KeyShot first")
    lux.deleteMaterial(name)
    MATERIAL_CREATED.remove(name)
    _save_created_registry()
    lux.sync()
    return {"discarded": name}


def op_material_texture_apply(c):
    """Attach common image maps to an unassigned Director-created material only."""
    name = str(c.get("name", ""))
    if name not in MATERIAL_CREATED:
        raise ValueError("Texture maps can only be wired to a Director-created material")
    root_dir = os.path.realpath(os.path.join(BASE, "..", "materials", "texture-sets"))
    requested = c.get("maps")
    if not isinstance(requested, list) or not requested or len(requested) > 8:
        raise ValueError("Provide one to eight supported texture maps")
    targets = {"base-color": "diffuse", "roughness": "roughness", "normal": "bumpmap",
               "bump": "bumpmap", "specular": "specular"}
    clean = []
    seen = set()
    seen_targets = set()
    for item in requested:
        role = str(item.get("role", ""))
        if role not in targets or role in seen:
            raise ValueError("Unsupported or duplicate map role: " + role)
        if targets[role] in seen_targets:
            raise ValueError("Only one map can currently drive each shader input")
        seen.add(role)
        seen_targets.add(targets[role])
        file_path = os.path.realpath(str(item.get("path", "")))
        if os.path.commonpath((root_dir, file_path)) != root_dir or not os.path.isfile(file_path):
            raise ValueError("Texture map must be an existing file inside Director's imported texture sets")
        clean.append((role, file_path))

    g = _material_graph(name)
    root = g.getRoot()
    surface_edge = root.getInputEdge("surface")
    if surface_edge is None:
        raise ValueError("Director material has no surface shader")
    original_shader = surface_edge.getSourceNode()
    shader = original_shader
    made = []
    replace_diffuse = False
    if original_shader.getType().get("name") == lux.SHADER_TYPE_DIFFUSE:
        if original_shader.getInputEdges():
            raise ValueError("Only an empty Director Diffuse material can be upgraded to Plastic; create a fresh material")
        shader = g.newNode(lux.SHADER_TYPE_PLASTIC)
        if shader is None:
            raise RuntimeError("KeyShot could not create a Plastic material node")
        made.append(shader)
        replace_diffuse = True
    parameters = dict((p.getName(), p) for p in shader.getParameters())
    for role in seen:
        target = targets[role]
        if target not in parameters:
            for node in reversed(made):
                try: g.removeNode(node)
                except Exception: pass
            raise ValueError("This material shader does not support the '" + role + "' input")

    existing_targets = set()
    for edge in shader.getInputEdges():
        for target_name in targets.values():
            try:
                if shader.getInputEdge(target_name).getID() == edge.getID():
                    existing_targets.add(target_name)
            except Exception:
                pass
    if any(targets[role] in existing_targets for role, _ in clean):
        raise ValueError("This material already has a map on one of those inputs; create a fresh Director material to avoid replacing it")

    linked = []
    try:
        map_nodes = []
        for role, file_path in clean:
            node = g.newNode(lux.SHADER_TYPE_TEXTURE_MAP)
            if node is None:
                raise RuntimeError("KeyShot could not create a Texture Map node")
            made.append(node)
            params = dict((p.getName(), p) for p in node.getParameters())
            if "texture" not in params:
                raise RuntimeError("KeyShot Texture Map has no image-file input")
            params["texture"].setValue(file_path)
            if "normal" in params:
                params["normal"].setValue(role == "normal")
            if role in ("roughness", "specular", "normal", "bump") and "texture_use_profile" in params:
                params["texture_use_profile"].setValue(False)
            if role == "normal" and "bump_height" in params:
                params["bump_height"].setValue(1.0)
            map_nodes.append(node)
        for (role, _file_path), node in zip(clean, map_nodes):
            if role == "roughness":
                utility = g.newNode(lux.SHADER_TYPE_COLOR_TO_NUMBER)
                if utility is None:
                    raise RuntimeError("KeyShot could not create a Color To Number node for roughness")
                made.append(utility)
                utility_params = dict((p.getName(), p) for p in utility.getParameters())
                if "input" not in utility_params:
                    raise RuntimeError("KeyShot Color To Number has no color input")
                g.newEdge(node, utility, "input")
                g.newEdge(utility, shader, "roughness")
                linked.append({"role": role, "target": "roughness", "node_id": node.getID(),
                               "utility_node_id": utility.getID(), "utility": "Color To Number"})
            else:
                g.newEdge(node, shader, targets[role])
                linked.append({"role": role, "target": targets[role], "node_id": node.getID()})
        if replace_diffuse:
            g.removeEdge(surface_edge)
            try:
                g.newEdge(shader, root, "surface")
            except Exception:
                g.newEdge(original_shader, root, "surface")
                raise
            try:
                g.removeNode(original_shader)
            except Exception:
                pass
        lux.sync()
    except Exception:
        for node in reversed(made):
            try:
                g.removeNode(node)
            except Exception:
                pass
        try:
            lux.sync()
        except Exception:
            pass
        raise
    return {"name": name, "maps": linked, "note": "Material is still unassigned; original product materials were not changed."}


MATERIAL_OPS = {"materials_list": op_materials_list, "material_inspect": op_material_inspect,
                "material_create": op_material_create, "material_edit_target": op_material_edit_target,
                "material_set": op_material_set,
                "material_undo": op_material_undo, "material_save": op_material_save,
                "material_discard": op_material_discard, "material_texture_apply": op_material_texture_apply}
