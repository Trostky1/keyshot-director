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
            if not node.isObject():
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
    if node is None or node.isDeleted() or not node.isObject() or node.getID() not in set(lux.getObjects()) or node.isLocked() or node.isHidden():
        raise ValueError("Choose an unlocked scene object")
    parent = node.getParent()
    root_id = lux.getSceneTree().getID()
    while parent and parent.getID() != root_id:
        if parent.isLocked() or parent.isHidden():
            raise ValueError("The selected part belongs to a hidden or locked assembly")
        parent = parent.getParent()
    try:
        before_assignment = lux.getObjectMaterial(object_id)
        before_assignment = before_assignment[0] if isinstance(before_assignment, (list, tuple)) and before_assignment else before_assignment
    except Exception:
        before_assignment = None
    lux.setObjectMaterial(source, object_id, link=False)
    copied = lux.getObjectMaterial(object_id)
    copied = copied[0] if isinstance(copied, (list, tuple)) and copied else copied
    copied = str(copied)
    if not copied or copied == source:
        raise RuntimeError("KeyShot did not create an independent scene copy")
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
    out = []
    for node in lux.getSceneTree().find(""):
        try:
            if node.isDeleted() or not node.isObject() or node.isLocked() or node.isHidden():
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
    if node is None or node.isDeleted() or not node.isObject():
        raise ValueError("Choose a valid scene object that uses this material")
    current = lux.getObjectMaterial(object_id)
    current = current[0] if isinstance(current, (list, tuple)) and current else current
    if str(current) != source:
        raise ValueError("That scene object no longer uses the selected source material; refresh and try again")
    lux.setObjectMaterial(source, object_id, link=False)
    copied = lux.getObjectMaterial(object_id)
    copied = copied[0] if isinstance(copied, (list, tuple)) and copied else copied
    copied = str(copied)
    if not copied or copied == source:
        raise RuntimeError("KeyShot did not return an independent material copy; source was left unchanged")
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
    library_folder = "Director"
    already_in_library = name in lux.getLibraryMaterials()
    library_saved = bool(lux.saveMaterial(name, library_folder))
    in_library_after_save = name in lux.getLibraryMaterials()
    if not library_saved and not already_in_library and not in_library_after_save:
        raise RuntimeError("KeyShot could not confirm this material in its Director library folder")
    if not lux.saveMaterialPackage(name, dst) or not os.path.isfile(dst):
        raise RuntimeError("KeyShot saved the library material but package export failed")
    return {"name": name, "path": dst, "library": library_saved or already_in_library or in_library_after_save,
            "library_folder": library_folder}


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


def op_material_apply_selection(c):
    name = str(c.get('name', ''))
    if name not in MATERIAL_CREATED:
        raise ValueError("Texture maps can only be wired to a Director-created material")
    root_dir = os.path.realpath(os.path.join(BASE, "..", "materials", "texture-sets"))
    requested = c.get("maps")
    if not isinstance(requested, list) or not requested or len(requested) > 8:
        raise ValueError("Provide one to eight supported texture maps")
    model = str(c.get("model", "Plastic"))
    if model not in ("Plastic", "Generic"):
        raise ValueError("The selected graph profile is not supported yet")
    targets = {"base-color": "diffuse", "ambient-occlusion": "ao-composite",
               "roughness": "roughness", "metallic": "metallic", "normal": "bumpmap",
               "bump": "bumpmap", "specular": "specular", "displacement": "geometry"}
    height_mm = c.get("displacement_height_mm", 0.1)
    if isinstance(height_mm, bool) or not isinstance(height_mm, (int, float)) or not math.isfinite(height_mm) or not 0.01 <= height_mm <= 5:
        raise ValueError("Displacement height must be between 0.01 and 5 mm")
    clean = []
    seen = set()
    seen_targets = set()
    for item in requested:
        role = str(item.get('role', ''))
        if role not in supported or role in seen:
            raise ValueError('Unsupported or duplicate map role: ' + role)
        file_path = os.path.realpath(str(item.get('path', '')))
        if os.path.commonpath((root_dir, file_path)) != root_dir or not os.path.isfile(file_path):
            raise ValueError('Texture map must be an existing file inside Director imported texture sets')
        seen.add(role)
        clean.append((role, file_path))
    if 'normal' in seen and 'bump' in seen:
        clean = [(role, file_path) for role, file_path in clean if role != 'bump']
        seen.remove('bump')
    if metal_mode == 'mixed' and 'metallic' not in seen:
        raise ValueError('Mixed metal mode requires a Metallic map to drive the Plastic label')
    # A metallic map is a mask for mixed metal/dielectric surfaces. For an
    # all-plastic/fabric or all-metal surface, choose the physical shader
    # directly instead of wrapping the Metal shader in a needless label.
    if metal_mode != 'mixed' and 'metallic' in seen:
        clean = [(role, file_path) for role, file_path in clean if role != 'metallic']
        seen.remove('metallic')
    # Never displace geometry unless the source MaterialX graph explicitly asks
    # for a non-zero scale. An unscaled height map must not deform the model.
    if 'displacement' in seen and displacement_height <= 0.0:
        clean = [(role, file_path) for role, file_path in clean if role != 'displacement']
        seen.remove('displacement')

    g = _material_graph(name)
    root = g.getRoot()
    if "displacement" in seen:
        try:
            existing_geometry = root.getInputEdge("geometry")
        except Exception:
            existing_geometry = None
        if existing_geometry is not None:
            raise ValueError("This material already has a geometry node")
    if "ambient-occlusion" in seen and "base-color" not in seen:
        raise ValueError("AO needs a Base Color map for its Multiply composite")
    surface_edge = root.getInputEdge("surface")
    if surface_edge is None:
        raise ValueError('Director material has no surface shader')
    original_shader = surface_edge.getSourceNode()
    made = []
    replace_diffuse = False
    if original_shader.getType().get("name") == lux.SHADER_TYPE_DIFFUSE:
        if original_shader.getInputEdges():
            raise ValueError("Only an empty Director Diffuse material can be upgraded; create a fresh material")
        shader_type = lux.SHADER_TYPE_GENERIC if model == "Generic" else lux.SHADER_TYPE_PLASTIC
        shader = g.newNode(shader_type)
        if shader is None:
            raise RuntimeError("KeyShot could not create the requested material graph node")
        made.append(shader)
        replace_diffuse = True
    parameters = dict((p.getName(), p) for p in shader.getParameters())
    aliases = {"diffuse": ("diffuse", "base_color", "basecolor"),
               "roughness": ("roughness", "specular_roughness"),
               "metallic": ("metallic", "metalness"),
               "bumpmap": ("bumpmap", "bump"), "specular": ("specular",)}
    resolved_targets = {}
    for role in seen - {"ambient-occlusion", "displacement"}:
        requested_target = targets[role]
        target = next((candidate for candidate in aliases.get(requested_target, (requested_target,)) if candidate in parameters), None)
        if target is None:
            for node in reversed(made):
                try: g.removeNode(node)
                except Exception: pass
            raise ValueError("This material shader does not support the '" + role + "' input")
        resolved_targets[role] = target

    existing_targets = set()
    for edge in shader.getInputEdges():
        for target_name in set(resolved_targets.values()):
            try:
                if shader.getInputEdge(target_name).getID() == edge.getID():
                    existing_targets.add(target_name)
            except Exception:
                pass
    if any(resolved_targets[role] in existing_targets for role, _ in clean if role in resolved_targets):
        raise ValueError("This material already has a map on one of those inputs; create a fresh Director material to avoid replacing it")

    linked = []
    try:
        mapping = g.newNode(lux.SHADER_TYPE_MAPPING_2D)
        if mapping is None:
            raise RuntimeError('KeyShot could not create a Mapping 2D node')
        made.append(mapping)
        mapping_params = dict((p.getName(), p) for p in mapping.getParameters())
        projection_param = mapping_params.get('uv_mapping')
        if projection_param is None:
            raise RuntimeError('KeyShot Mapping 2D node has no projection setting')
        projection_param.setValue(projection_values[projection_name])
        for axis in ('uv_scale_u', 'uv_scale_v'):
            if axis in mapping_params:
                mapping_params[axis].setValue(mapping_size)
        use_metal_layer = metal_mode == 'mixed' and 'metallic' in seen
        primary_is_metal = metal_mode in ('metal', 'mixed')
        primary = g.newNode(lux.SHADER_TYPE_METAL if primary_is_metal else lux.SHADER_TYPE_ADVANCED)
        if primary is None:
            raise RuntimeError('KeyShot could not create the Advanced/Metal shader node')
        made.append(primary)
        plastic = None
        if use_metal_layer:
            plastic = g.newNode(lux.SHADER_TYPE_PLASTIC)
            if plastic is None:
                raise RuntimeError('KeyShot could not create the Plastic label shader for the Metalness map')
            made.append(plastic)

        map_nodes = {}
        for role, file_path in clean:
            node = g.newNode(lux.SHADER_TYPE_TEXTURE_MAP)
            if node is None:
                raise RuntimeError('KeyShot could not create a Texture Map node')
            made.append(node)
            params = dict((p.getName(), p) for p in node.getParameters())
            if "texture" not in params:
                raise RuntimeError("KeyShot Texture Map has no image-file input")
            params["texture"].setValue(file_path)
            if "normal" in params:
                params["normal"].setValue(role == "normal")
            if "texture_use_srgb" in params:
                params["texture_use_srgb"].setValue(role == "base-color")
            if role in ("roughness", "metallic", "specular", "normal", "bump", "ambient-occlusion", "displacement") and "texture_use_profile" in params:
                params["texture_use_profile"].setValue(False)
            if role == "normal" and "bump_height" in params:
                params["bump_height"].setValue(1.0)
            map_nodes.append(node)
        map_by_role = {role: node for (role, _file_path), node in zip(clean, map_nodes)}
        if "ambient-occlusion" in seen:
            composite = g.newNode(lux.SHADER_TYPE_COLOR_COMPOSITE)
            if composite is None:
                raise RuntimeError("KeyShot could not create a Color Composite node for AO")
            made.append(composite)
            composite_params = {p.getName(): p for p in composite.getParameters()}
            if not all(key in composite_params for key in ("source", "background", "blend_mode")):
                raise RuntimeError("KeyShot Color Composite lacks the inputs needed for AO")
            composite_params["blend_mode"].setValue(1)  # KeyShot Color Composite: Normal=0, Multiply=1.
            g.newEdge(map_by_role["base-color"], composite, "background")
            g.newEdge(map_by_role["ambient-occlusion"], composite, "source")
            g.newEdge(composite, shader, resolved_targets["base-color"])
            linked.append({"role": "ambient-occlusion", "target": "diffuse via Color Composite Multiply",
                           "node_id": map_by_role["ambient-occlusion"].getID(), "utility_node_id": composite.getID()})
        if "displacement" in seen:
            displace = g.newNode(lux.SHADER_TYPE_DISPLACE)
            if displace is None:
                raise RuntimeError("KeyShot could not create a Displace geometry node")
            made.append(displace)
            displace_params = {p.getName(): p for p in displace.getParameters()}
            for key in ("displace", "displacement height", "resolution", "max triangles (millions)"):
                if key not in displace_params:
                    raise RuntimeError("KeyShot Displace node lacks the " + key + " input")
            displace_params["displacement height"].setValue(float(height_mm) / 1000.0)
            displace_params["resolution"].setValue(0.0002)
            displace_params["max triangles (millions)"].setValue(1.0)
            g.newEdge(map_by_role["displacement"], displace, "displace")
            g.newEdge(displace, root, "geometry")
            linked.append({"role": "displacement", "target": "root geometry",
                           "node_id": map_by_role["displacement"].getID(), "utility_node_id": displace.getID(),
                           "height_mm": height_mm, "executed": False})
        for (role, _file_path), node in zip(clean, map_nodes):
            if role in ("ambient-occlusion", "displacement"):
                continue
            if role == "base-color" and "ambient-occlusion" in seen:
                linked.append({"role": role, "target": "diffuse via Color Composite Multiply", "node_id": node.getID()})
                continue
            if role == "roughness":
                utility = g.newNode(lux.SHADER_TYPE_COLOR_TO_NUMBER)
                if utility is None:
                    raise RuntimeError('KeyShot could not create Color To Number for roughness')
                made.append(utility)
                utility_params = dict((p.getName(), p) for p in utility.getParameters())
                if "input" not in utility_params:
                    raise RuntimeError("KeyShot Color To Number has no color input")
                g.newEdge(node, utility, "input")
                g.newEdge(utility, shader, resolved_targets[role])
                linked.append({"role": role, "target": resolved_targets[role], "node_id": node.getID(),
                               "utility_node_id": utility.getID(), "utility": "Color To Number"})
            else:
                g.newEdge(node, shader, resolved_targets[role])
                linked.append({"role": role, "target": resolved_targets[role], "node_id": node.getID()})
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
    return {"name": name, "model": model, "maps": linked, "note": "Material is still unassigned; original product materials were not changed."}


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
    prior_strength = next((p for p in shader.getParameters() if p.getName() in ("bump_height", "bump_scale", "bump_strength")), None)
    old_strength = _parameter_value(prior_strength) if prior_strength else None
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
                source = prior_edge.getSourceNode()
                g.newEdge(source, shader, target_input)
            if prior_strength is not None and old_strength is not None:
                prior_strength.setValue(tuple(old_strength) if isinstance(old_strength, list) else old_strength)
            lux.sync()
        except Exception:
            pass
        raise
    return {"name": name, "map": path, "role": role, "strength": _parameter_value(prior_strength) if prior_strength else None,
            "note": "Only the independent Director copy was changed; the source material was not modified."}


MATERIAL_OPS = {"materials_list": op_materials_list, "material_inspect": op_material_inspect,
                "material_targets": op_material_targets,
                "material_create": op_material_create, "material_edit_target": op_material_edit_target,
                "material_set": op_material_set,
                "material_undo": op_material_undo, "material_save": op_material_save,
                "material_discard": op_material_discard, "material_texture_apply": op_material_texture_apply,
                "material_add_geometry_template": op_material_add_geometry_template}
MATERIAL_OPS["material_copy"] = op_material_copy
MATERIAL_OPS["material_bump_set"] = op_material_bump_set
MATERIAL_OPS["material_library"] = op_material_library
MATERIAL_OPS["material_library_copy"] = op_material_library_copy
MATERIAL_OPS["material_scene_objects"] = op_material_scene_objects
