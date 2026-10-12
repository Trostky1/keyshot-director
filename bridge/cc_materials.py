# Material operations run inside KeyShot. New generated materials are unassigned;
# a library-material copy is applied only to the explicitly selected geometry.
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


def op_material_library_list(c):
    query = str(c.get('query', '')).strip().lower()
    materials = [str(x) for x in lux.getLibraryMaterials() if x]
    if query:
        materials = [name for name in materials if query in name.lower()]
    return {'materials': sorted(set(materials))[:250], 'query': query}


def op_material_library_copy(c):
    global MATERIAL_EDIT_TARGET
    source = str(c.get('name', '')).strip()
    library = [str(x) for x in lux.getLibraryMaterials() if x]
    if source not in library:
        raise ValueError('Choose a material that currently exists in the KeyShot Material Library.')
    objects = _selected_geometry()
    if not objects:
        raise ValueError('Select the target part in KeyShot first. The library material will be copied onto that selection.')
    first_id = objects[0]['id']
    previous = lux.getObjectMaterial(first_id)
    if isinstance(previous, (list, tuple)):
        previous = previous[0] if previous else None
    lux.setObjectMaterial(source, first_id, False)
    lux.sync()
    copied = lux.getObjectMaterial(first_id)
    if isinstance(copied, (list, tuple)):
        copied = copied[0] if copied else None
    copied = str(copied or '')
    if not copied or copied == source:
        if previous:
            try:
                lux.setObjectMaterial(str(previous), first_id, True)
                lux.sync()
            except Exception:
                pass
        raise RuntimeError('KeyShot did not return a distinct copy name; the library source was not edited.')
    MATERIAL_CREATED.add(copied)
    _save_created_registry()
    for obj in objects[1:]:
        lux.setObjectMaterial(copied, obj['id'], True)
        lux.sync()
        assigned = lux.getObjectMaterial(obj['id'])
        if isinstance(assigned, (list, tuple)):
            assigned = assigned[0] if assigned else None
        if str(assigned or '') != copied:
            raise RuntimeError('The copy was created and applied to the first selected part, but KeyShot could not apply it to every selected part.')
    MATERIAL_EDIT_TARGET = copied
    lux.sync()
    return {'source': source, 'name': copied, 'objects': objects, 'editable_target': copied}


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
        raise ValueError('Only a new Director material can be applied by this workflow')
    objects = _selected_geometry()
    if not objects:
        raise ValueError('Select one or more product parts in KeyShot, then build again.')
    for obj in objects:
        object_id = obj['id']
        lux.setObjectMaterial(name, object_id, True)
        lux.sync()
        assigned = lux.getObjectMaterial(object_id)
        if isinstance(assigned, (list, tuple)):
            assigned = assigned[0] if assigned else None
        if str(assigned or '') != name:
            raise RuntimeError('KeyShot did not confirm the new material assignment on ' + obj['name'] + '.')
    return {'name': name, 'objects': objects, 'applied': True}


def op_material_texture_apply(c):
    """Build an Advanced PBR graph, with shared mapping and optional metal, bump and displacement nodes."""
    name = str(c.get('name', ''))
    if name not in MATERIAL_CREATED:
        raise ValueError('Texture maps can only be wired to a Director-created material')
    root_dir = os.path.realpath(os.path.join(BASE, '..', 'materials', 'texture-sets'))
    requested = c.get('maps')
    if not isinstance(requested, list) or not requested or len(requested) > 12:
        raise ValueError('Provide one to twelve supported texture maps')
    supported = {'base-color', 'roughness', 'glossiness', 'normal', 'bump', 'specular', 'metallic', 'displacement'}
    metal_mode = str(c.get('metal_mode', 'mixed')).strip().lower()
    if metal_mode not in ('plastic', 'metal', 'mixed'):
        raise ValueError('Surface type must be plastic, metal, or mixed metal and plastic')
    projection_name = str(c.get('projection', 'box')).strip().lower()
    projection_values = {'planar': 0, 'box': 1, 'cylinder': 2, 'sphere': 3, 'uv': 4, 'camera': 5}
    if projection_name not in projection_values:
        raise ValueError('Projection must be planar, box, cylinder, sphere, UV, or camera')
    try:
        mapping_size = float(c.get('mapping_size_m', 0.3))
        displacement_height = float(c.get('displacement_height_m', 0.0))
    except (TypeError, ValueError):
        raise ValueError('Mapping size and displacement height must be numeric')
    if not math.isfinite(mapping_size) or mapping_size <= 0.0 or mapping_size > 1000.0:
        raise ValueError('Texture mapping size must be between 0 and 1000 meters')
    if not math.isfinite(displacement_height) or displacement_height < 0.0 or displacement_height > 10.0:
        raise ValueError('Displacement height must be between 0 and 10 meters')
    clean, seen = [], set()
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
    surface_edge = root.getInputEdge('surface')
    if surface_edge is None:
        raise ValueError('Director material has no surface shader')
    original_shader = surface_edge.getSourceNode()
    made = []
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
            if 'texture' not in params:
                raise RuntimeError('KeyShot Texture Map has no image-file input')
            params['texture'].setValue(file_path)
            if 'normal' in params:
                params['normal'].setValue(role == 'normal')
            if role in ('roughness', 'glossiness', 'specular', 'normal', 'bump', 'metallic', 'displacement') and 'texture_use_profile' in params:
                params['texture_use_profile'].setValue(False)
            if role == 'normal' and 'bump_height' in params:
                params['bump_height'].setValue(-1.0)
            # `uv_mapping` is the Mapping Type enum, not a graph input. KeyShot
            # exposes the connectable Mapping 2D shader socket as `uv_shader`.
            uv_input = params.get('uv_shader')
            if uv_input is None:
                raise RuntimeError('KeyShot Texture Map has no UV Mapping shader input')
            mapping_type = params.get('uv_mapping')
            if mapping_type is None:
                raise RuntimeError('KeyShot Texture Map has no Mapping Type setting')
            # KeyShot's enum values follow Planar, Box, Cylinder, Sphere, UV,
            # Camera, Node. Node=6 is required for the UV shader edge to drive
            # mapping; otherwise each map silently keeps its default Box map.
            mapping_type.setValue(6)
            g.newEdge(mapping, node, uv_input.getName())
            map_nodes[role] = node

        def link_map(role, shader, target):
            if role not in map_nodes:
                return
            parameters = dict((p.getName(), p) for p in shader.getParameters())
            if target not in parameters:
                raise ValueError("KeyShot shader does not expose '" + target + "' for the " + role + ' map')
            node = map_nodes[role]
            if role == 'glossiness':
                invert = g.newNode(lux.SHADER_TYPE_COLOR_INVERT)
                if invert is None:
                    raise RuntimeError('KeyShot could not create a Color Invert node for glossiness')
                made.append(invert)
                in_params = dict((p.getName(), p) for p in invert.getParameters())
                input_name = 'source' if 'source' in in_params else 'input'
                g.newEdge(node, invert, input_name)
                node = invert
            if role in ('roughness', 'glossiness'):
                utility = g.newNode(lux.SHADER_TYPE_COLOR_TO_NUMBER)
                if utility is None:
                    raise RuntimeError('KeyShot could not create Color To Number for roughness')
                made.append(utility)
                if 'input' not in dict((p.getName(), p) for p in utility.getParameters()):
                    raise RuntimeError('KeyShot Color To Number has no color input')
                g.newEdge(node, utility, 'input')
                g.newEdge(utility, shader, target)
                linked.append({'role': role, 'target': target, 'node_id': map_nodes[role].getID(), 'utility': 'Color To Number'})
            else:
                g.newEdge(node, shader, target)
                linked.append({'role': role, 'target': target, 'node_id': map_nodes[role].getID()})

        if use_metal_layer:
            link_map('base-color', primary, 'color')
            link_map('roughness', primary, 'roughness')
            link_map('glossiness', primary, 'roughness')
            link_map('normal', primary, 'bumpmap')
            link_map('bump', primary, 'bumpmap')
            link_map('base-color', plastic, 'diffuse')
            link_map('roughness', plastic, 'roughness')
            link_map('glossiness', plastic, 'roughness')
            link_map('normal', plastic, 'bumpmap')
            link_map('bump', plastic, 'bumpmap')
            metal_invert = g.newNode(lux.SHADER_TYPE_COLOR_INVERT)
            if metal_invert is None:
                raise RuntimeError('KeyShot could not create a Color Invert node for Metalness')
            made.append(metal_invert)
            inv_params = dict((p.getName(), p) for p in metal_invert.getParameters())
            g.newEdge(map_nodes['metallic'], metal_invert, 'source' if 'source' in inv_params else 'input')
            plastic_params = dict((p.getName(), p) for p in plastic.getParameters())
            opacity_input = 'opacitymap' if 'opacitymap' in plastic_params else ('opacity' if 'opacity' in plastic_params else None)
            if opacity_input is None:
                raise ValueError('KeyShot Plastic label shader has no opacity map input')
            g.newEdge(metal_invert, plastic, opacity_input)
            root_params = dict((p.getName(), p) for p in root.getParameters())
            label_input = 'labels' if 'labels' in root_params else ('label' if 'label' in root_params else None)
            if label_input is None:
                raise ValueError('KeyShot Material node has no label shader input')
            g.newEdge(plastic, root, label_input)
            linked.append({'role': 'metallic', 'target': 'Plastic label opacity map', 'node_id': map_nodes['metallic'].getID(), 'utility': 'Color Invert'})
        else:
            link_map('base-color', primary, 'color' if primary_is_metal else 'diffuse')
            link_map('roughness', primary, 'roughness')
            link_map('glossiness', primary, 'roughness')
            link_map('normal', primary, 'bumpmap')
            link_map('bump', primary, 'bumpmap')
            if not primary_is_metal:
                link_map('specular', primary, 'specular')

        if 'displacement' in map_nodes:
            displace = g.newNode(lux.SHADER_TYPE_DISPLACE)
            if displace is None:
                raise RuntimeError('KeyShot could not create a Displace node')
            made.append(displace)
            displace_params = dict((p.getName(), p) for p in displace.getParameters())
            height = displace_params.get('displacement height')
            if height is None:
                height = next((p for p in displace.getParameters()
                               if str(p.getDisplayName()).strip().lower() == 'displacement height'), None)
            if height is not None:
                height.setValue(displacement_height)
            g.newEdge(map_nodes['displacement'], displace, 'displace')
            g.newEdge(displace, root, 'geometry')
            linked.append({'role': 'displacement', 'target': 'Geometry', 'node_id': map_nodes['displacement'].getID(), 'geometry_node_id': displace.getID()})

        g.removeEdge(surface_edge)
        try:
            g.newEdge(primary, root, 'surface')
        except Exception:
            g.newEdge(original_shader, root, 'surface')
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
    return {'name': name, 'maps': linked, 'metal_mode': metal_mode,
            'projection': projection_name,
            'note': 'KeyShot material graph built; material is not assigned until the explicit apply-to-selection step.'}

MATERIAL_OPS = {"materials_list": op_materials_list, "material_library_list": op_material_library_list,
                "material_library_copy": op_material_library_copy, "material_inspect": op_material_inspect,
                "material_create": op_material_create, "material_edit_target": op_material_edit_target,
                "material_set": op_material_set,
                "material_undo": op_material_undo, "material_save": op_material_save,
                "material_discard": op_material_discard, "material_texture_apply": op_material_texture_apply,
                "material_selection": op_material_selection, "material_apply_selection": op_material_apply_selection}
