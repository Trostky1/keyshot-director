"""Isolated bridge receipt tests; never connects to KeyShot."""
import json
import math
import os
import unittest
from pathlib import Path
from types import SimpleNamespace


class MaterialReceipts(unittest.TestCase):
    def setUp(self):
        self.value = 0.3
        self.assignment = "Director Copy"
        self.scene_file = "C:/scenes/test.bip"
        self.root_id = 0
        self.connected = None
        self.parameter = SimpleNamespace(getName=lambda: "roughness", getValue=lambda: self.value,
                                         setValue=lambda value: setattr(self, "value", value))
        self.node = SimpleNamespace(getID=lambda: 7, getParameters=lambda: [self.parameter],
                                    getInputEdge=lambda name: self.connected)
        self.graph = SimpleNamespace(getNodes=lambda: [self.node])
        self.obj = SimpleNamespace(getID=lambda: 1, isDeleted=lambda: False,
                                   isLocked=lambda: False, isHidden=lambda: False, getParent=lambda: None)
        self.lux = SimpleNamespace(getSceneMaterials=lambda: ["Director Copy", "Original"],
            getSceneInfo=lambda: dict(file=self.scene_file, name="Test", unit="mm", unitScale=0.001),
            getMaterialGraph=lambda name: self.graph, sync=lambda: None,
            getSceneTree=lambda: SimpleNamespace(find=lambda query: [self.obj], getID=lambda: self.root_id),
            getObjectMaterial=lambda object_id: self.assignment,
            setObjectMaterial=lambda name, object_id, link: setattr(self, "assignment", name))
        self.ns = dict(os=os, json=json, math=math,
                       BASE=str(Path(__file__).parent / "nonexistent-receipt-test-base"), lux=self.lux)
        source = Path(__file__).resolve().parents[1] / "bridge" / "cc_materials.py"
        exec(compile(source.read_text(encoding="utf-8-sig"), str(source), "exec"), self.ns)
        self.ns["MATERIAL_CREATED"].add("Director Copy")

    def test_value_round_trip_and_receipt(self):
        self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6, expected_value=0.3))
        self.assertEqual(self.value, 0.6)
        self.ns["op_material_undo"]({})
        self.assertEqual(self.value, 0.3)
        self.assertEqual(self.ns["MATERIAL_UNDO"], [])

    def test_stale_edit_rejected_without_mutation(self):
        with self.assertRaisesRegex(ValueError, "changed since inspection"):
            self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6, expected_value=0.2))
        self.assertEqual(self.value, 0.3)

    def test_stale_undo_retains_receipt(self):
        self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6))
        self.value = 0.9
        with self.assertRaisesRegex(ValueError, "undo refused"):
            self.ns["op_material_undo"]({})
        self.assertEqual(len(self.ns["MATERIAL_UNDO"]), 1)
        self.assertEqual(self.value, 0.9)

    def test_assignment_undo_and_stale_refusal(self):
        self.ns["_remember_material_edit"](dict(kind="assignment", name="Director Copy", object_id=1, before="Original", after="Director Copy"))
        self.assignment = "Outside edit"
        with self.assertRaisesRegex(ValueError, "undo refused"):
            self.ns["op_material_undo"]({})
        self.assignment = "Director Copy"
        self.ns["op_material_undo"]({})
        self.assertEqual(self.assignment, "Original")

    def test_history_bounded(self):
        for index in range(25):
            self.ns["_remember_material_edit"](dict(kind="value", name=str(index)))
        self.assertEqual(len(self.ns["MATERIAL_UNDO"]), 20)
        self.assertEqual(self.ns["MATERIAL_UNDO"][0]["name"], "5")

    def test_map_strength_undo_and_external_change(self):
        self.parameter.getName = lambda: "bump_height"
        self.graph.getRoot = lambda: SimpleNamespace(getInputEdge=lambda socket:
            SimpleNamespace(getSourceNode=lambda: self.node))
        self.node.getParameters = lambda: [self.parameter, SimpleNamespace(getName=lambda: "bumpmap")]
        self.ns["MATERIAL_COPIES"].add("Director Copy")
        result = self.ns["op_material_bump_set"](dict(name="Director Copy", strength=0.7))
        self.assertEqual(result["receipt"]["kind"], "map")
        self.value = 0.8
        with self.assertRaisesRegex(ValueError, "undo refused"):
            self.ns["op_material_undo"]({})
        self.value = 0.7
        self.ns["op_material_undo"]({})
        self.assertEqual(self.value, 0.3)

    def test_graph_channel_provenance(self):
        self.node.getType = lambda: dict(name="plastic", display_name="Plastic")
        self.node.getInputEdges = lambda: []
        self.parameter.getType = lambda: "float"
        edge = SimpleNamespace(getSourceNode=lambda: self.node, isEnabled=lambda: True)
        self.graph.getRoot = lambda: SimpleNamespace(getInputEdge=lambda socket: edge if socket == "surface" else None)
        result = self.ns["op_material_inspect"](dict(name="Director Copy"))
        self.assertEqual(result["root_channels"][0]["source_node_id"], 7)
        self.assertIsNone(result["root_channels"][2]["source_node_id"])
        self.assertIn("Geometry execution", result["undo"]["scope"])

    def test_map_replacement_restores_original_source(self):
        original = SimpleNamespace(getID=lambda: 11)
        created = SimpleNamespace(getID=lambda: 12,
            getParameters=lambda: [SimpleNamespace(getName=lambda: "texture", setValue=lambda value: None)])
        def edge(source):
            return SimpleNamespace(getSourceNode=lambda: source, isEnabled=lambda: True)
        self.connected = edge(original)
        self.node.getParameters = lambda: [self.parameter, SimpleNamespace(getName=lambda: "bumpmap")]
        self.graph.getRoot = lambda: SimpleNamespace(getInputEdge=lambda socket: edge(self.node))
        self.graph.getNodes = lambda: [self.node, original, created]
        self.graph.newNode = lambda kind: created
        self.graph.newEdge = lambda source, target, socket: setattr(self, "connected", edge(source))
        self.graph.removeEdge = lambda old: setattr(self, "connected", None)
        self.lux.SHADER_TYPE_TEXTURE_MAP = 1
        self.ns["MATERIAL_COPIES"].add("Director Copy")
        # File containment is covered elsewhere; this fake isolates graph topology.
        self.ns["os"] = SimpleNamespace(path=SimpleNamespace(normcase=os.path.normcase, abspath=os.path.abspath, realpath=lambda value: value,
            join=lambda *values: "/".join(values), commonpath=lambda values: values[0], isfile=lambda value: True))
        self.ns["op_material_bump_set"](dict(name="Director Copy", path="imported-map.png"))
        self.assertEqual(self.connected.getSourceNode().getID(), 12)
        self.ns["op_material_undo"]({})
        self.assertEqual(self.connected.getSourceNode().getID(), 11)

    def test_different_scene_refuses_undo_with_identical_material(self):
        self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6))
        self.scene_file = "C:/scenes/reopened-other.bip"
        with self.assertRaisesRegex(ValueError, "Scene identity changed"):
            self.ns["op_material_undo"]({})
        self.assertEqual(self.value, 0.6)
        self.assertEqual(len(self.ns["MATERIAL_UNDO"]), 1)

    def test_unavailable_scene_identity_refuses_undo(self):
        self.scene_file = ""
        self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6))
        with self.assertRaisesRegex(ValueError, "cannot be verified"):
            self.ns["op_material_undo"]({})
        self.assertEqual(self.value, 0.6)

    def test_reopened_scene_with_new_root_refuses_undo(self):
        self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6))
        self.root_id = 44
        with self.assertRaisesRegex(ValueError, "Scene identity changed"):
            self.ns["op_material_undo"]({})
        self.assertEqual(len(self.ns["MATERIAL_UNDO"]), 1)

    def test_copy_failure_after_assignment_restores_original(self):
        self.assignment = "Original"
        self.lux.getObjects = lambda: [1]
        self.lux.setObjectMaterial = lambda name, object_id, link: setattr(self, "assignment", name if link else "Director Copy")
        def fail_registry():
            self.assertEqual(self.ns["MATERIAL_UNDO"][-1]["kind"], "assignment")
            raise OSError("registry unavailable")
        self.ns["_save_created_registry"] = fail_registry
        with self.assertRaisesRegex(OSError, "registry unavailable"):
            self.ns["op_material_copy"](dict(source="Original", object_id=1, name="Director Test Copy"))
        self.assertEqual(self.assignment, "Original")
        self.assertEqual(self.ns["MATERIAL_UNDO"], [])

    def test_sync_failure_restores_value(self):
        calls = []
        def sync():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("sync failed")
        self.lux.sync = sync
        with self.assertRaisesRegex(RuntimeError, "sync failed"):
            self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.6))
        self.assertEqual(self.value, 0.3)
        self.assertEqual(self.ns["MATERIAL_UNDO"], [])

    def test_post_sync_native_clamp_is_recorded_for_undo(self):
        self.lux.sync = lambda: setattr(self, "value", min(self.value, 0.5))
        result = self.ns["op_material_set"](dict(name="Director Copy", node_id=7, parameter="roughness", value=0.8))
        self.assertEqual(result["after"], 0.5)
        self.assertEqual(self.ns["MATERIAL_UNDO"][-1]["after"], 0.5)
        self.ns["op_material_undo"]({})
        self.assertEqual(self.value, 0.3)


if __name__ == "__main__":
    unittest.main()
