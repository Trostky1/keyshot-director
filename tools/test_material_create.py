"""Isolated material-create bridge tests; never connects to KeyShot."""
import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


class MaterialCreateTests(unittest.TestCase):
    def setUp(self):
        self.materials = []
        self.create_result = None
        self.create_does_create = True
        self.graph = SimpleNamespace(
            getRoot=lambda: SimpleNamespace(getInputEdge=lambda socket: None),
            getNodes=lambda: [])

        def create_scene_material(name):
            if self.create_does_create:
                self.materials.append(name)
            return self.create_result

        def get_material_graph(name):
            if name not in self.materials:
                raise KeyError("unknown material")
            return self.graph

        self.lux = SimpleNamespace(
            getSceneMaterials=lambda: list(self.materials),
            createSceneMaterial=create_scene_material,
            getMaterialGraph=get_material_graph,
            sync=lambda: None)
        source = Path(__file__).resolve().parents[1] / "bridge" / "cc_materials.py"
        self.ns = dict(os=os, json=json,
                       BASE=str(Path(__file__).parent / "nonexistent-material-create-test-base"), lux=self.lux)
        exec(compile(source.read_text(encoding="utf-8-sig"), str(source), "exec"), self.ns)
        self.ns["_save_created_registry"] = lambda: None

    def test_none_return_is_success_when_graph_is_created(self):
        self.create_result = "none"
        result = self.ns["op_material_create"]({"name": "Director Poliigon Stone"})
        self.assertEqual(result["name"], "Director Poliigon Stone")
        self.assertIn("Director Poliigon Stone", self.ns["MATERIAL_CREATED"])

    def test_false_return_is_success_when_graph_readback_confirms_creation(self):
        self.create_result = False
        result = self.ns["op_material_create"]({"name": "Director Poliigon Metal"})
        self.assertEqual(result["name"], "Director Poliigon Metal")

    def test_failed_create_reports_return_and_graph_readback_error(self):
        self.create_result = False
        self.create_does_create = False
        with self.assertRaisesRegex(RuntimeError, "createSceneMaterial returned False.*unknown material"):
            self.ns["op_material_create"]({"name": "Director Poliigon Plastic"})
        self.assertNotIn("Director Poliigon Plastic", self.ns["MATERIAL_CREATED"])

    def test_fresh_diffuse_with_keyshot_default_inputs_can_receive_maps(self):
        shader = SimpleNamespace(
            getType=lambda: {"name": "lux_diffuse", "display_name": "Diffuse"},
            getInputEdges=lambda: [object()])
        edge = SimpleNamespace(getSourceNode=lambda: shader)
        root = SimpleNamespace(getInputEdge=lambda socket: edge if socket == "surface" else None)
        self.graph.getRoot = lambda: root
        self.lux.SHADER_TYPE_DIFFUSE = "lux_diffuse"
        name = "Director Poliigon Plastic"
        self.materials.append(name)
        self.ns["MATERIAL_CREATED"].add(name)
        self.ns["math"] = math
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            self.ns["BASE"] = os.path.join(directory, "bridge")
            maps = os.path.join(directory, "materials", "texture-sets")
            os.makedirs(maps)
            texture = os.path.join(maps, "map.png")
            Path(texture).write_bytes(b"placeholder")
            with self.assertRaisesRegex(ValueError, "Only the simple Plastic material workflow is enabled"):
                self.ns["op_material_texture_apply"]({
                    "name": name, "model": "Advanced",
                    "maps": [{"role": "base-color", "path": texture}]})


if __name__ == "__main__":
    unittest.main()
