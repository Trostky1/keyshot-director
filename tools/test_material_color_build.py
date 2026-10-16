"""Offline graph test for editable Poliigon Base Color; never connects to KeyShot."""
import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


class Param:
    def __init__(self, name, value=None):
        self.name, self.value = name, value

    def getName(self): return self.name
    def getValue(self): return self.value
    def setValue(self, value): self.value = value


class Node:
    next_id = 1

    def __init__(self, kind, params=()):
        self.kind, self.params, self.edges, self.name = kind, [Param(*p) for p in params], {}, kind
        self.id = Node.next_id
        Node.next_id += 1

    def getID(self): return self.id
    def getType(self): return {"name": self.kind}
    def getName(self): return self.name
    def setName(self, name): self.name = name
    def getParameters(self): return self.params
    def getInputEdge(self, socket): return self.edges.get(socket)
    def getInputEdges(self): return list(self.edges.values())


class Graph:
    def __init__(self):
        self.root = Node("__root")
        self.original = Node("lux_diffuse")
        self.nodes = [self.root, self.original]
        self.newEdge(self.original, self.root, "surface")

    def getRoot(self): return self.root
    def getNodes(self): return self.nodes

    def newNode(self, kind):
        params = {
            "__texture": (("texture", ""), ("normal", False), ("texture_use_srgb", False),
                          ("texture_use_profile", True), ("uv_mapping", 0), ("uv_scale_mode", 0), ("uv_scale_u", 0.041), ("uv_scale_v", 0.041)),
            "lux_color_adjust": (("color", None), ("colorize", [0.5, 0.5, 0.5]),
                                 ("value", 1.0), ("saturation", 1.0), ("contrast", 1.0)),
        }.get(kind, ())
        node = Node(kind, params)
        self.nodes.append(node)
        return node

    def newEdge(self, source, target, socket):
        edge = SimpleNamespace(getSourceNode=lambda: source, getID=lambda: source.getID())
        target.edges[socket] = edge
        return edge

    def removeEdge(self, edge):
        for node in self.nodes:
            for socket, candidate in list(node.edges.items()):
                if candidate is edge:
                    del node.edges[socket]

    def removeNode(self, node): self.nodes.remove(node)


class MaterialColorBuildTests(unittest.TestCase):
    def test_base_color_flows_directly_to_simple_plastic(self):
        graph = Graph()
        lux = SimpleNamespace(
            SHADER_TYPE_DIFFUSE="lux_diffuse", SHADER_TYPE_PLASTIC="lux_plastic",
            SHADER_TYPE_MAPPING_2D="mapping2d", SHADER_TYPE_TEXTURE_MAP="__texture",
            SHADER_TYPE_COLOR_ADJUST="lux_color_adjust",
            getSceneMaterials=lambda: ["Director Test Color"],
            getMaterialGraph=lambda name: graph, sync=lambda: None)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            texture_folder = Path(directory) / "materials" / "texture-sets"
            texture_folder.mkdir(parents=True)
            texture = texture_folder / "BaseColor.jpg"
            texture.write_bytes(b"test")
            ns = dict(os=os, json=json, math=math, lux=lux,
                      BASE=str(Path(directory) / "bridge"))
            source = Path(__file__).resolve().parents[1] / "bridge" / "cc_materials.py"
            exec(compile(source.read_text(encoding="utf-8-sig"), str(source), "exec"), ns)
            ns["MATERIAL_CREATED"].add("Director Test Color")
            ns["op_material_texture_apply"]({"name": "Director Test Color", "model": "Plastic",
                "maps": [{"role": "base-color", "path": str(texture)}]})
        shader = graph.root.getInputEdge("surface").getSourceNode()
        base = shader.getInputEdge("diffuse").getSourceNode()
        self.assertEqual(shader.kind, "lux_plastic")
        self.assertEqual(base.kind, "__texture")



if __name__ == "__main__": unittest.main()
