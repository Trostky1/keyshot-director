"""Clearing Director lights with one light that KeyShot refuses to remove. No KeyShot imports or live commands:
op_lights_clear and op_studio_off are lifted out of bridge/cc_lights.py and run against small fakes."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "bridge" / "cc_lights.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"))
WANTED = {"op_lights_clear", "op_studio_off"}
FUNCTIONS = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in WANTED]


class FakeEnvironment:
    def __init__(self, name):
        self.name = name

    def getName(self):
        return self.name


class FakeLux:
    def __init__(self, environments, active):
        self.environments, self.active, self.removed = list(environments), active, []

    def getEnvironments(self):
        return list(self.environments)

    def setActiveEnvironment(self, name):
        self.active = name

    def getActiveEnvironment(self):
        return FakeEnvironment(self.active)

    def removeEnvironment(self, name):
        self.environments.remove(name)
        self.removed.append(name)

    def sync(self):
        pass


class LightsClearTests(unittest.TestCase):
    def load(self, registry, refuse=(), environments=("Studio", "CC_Studio"), active="CC_Studio", prev="Studio"):
        self.assertEqual({f.name for f in FUNCTIONS}, WANTED)
        removed = []

        def remove(c):
            if c["id"] in refuse:
                raise RuntimeError("Director light %s cleanup is incomplete" % c["id"])
            registry.pop(c["id"])
            removed.append(c["id"])

        self.lux = FakeLux(environments, active)
        ns = {"REG": registry, "ENV_STATE": {"prev": prev}, "ENV_NAME": "CC_Studio", "lux": self.lux,
              "adopt_orphans": lambda: [], "op_light_remove": remove}
        exec(compile(ast.Module(body=FUNCTIONS, type_ignores=[]), str(SOURCE), "exec"), ns)
        return ns, removed

    def test_one_stuck_light_does_not_stop_the_others(self):
        registry = {"key": {}, "fill": {}, "rim": {}}
        ns, removed = self.load(registry, refuse={"fill"})
        result = ns["op_lights_clear"]({})
        self.assertEqual(result["cleared"], ["key", "rim"])
        self.assertEqual(list(result["failed"]), ["fill"])
        self.assertEqual(list(registry), ["fill"], "the stuck light stays registered so a retry can remove it")

    def test_studio_off_still_restores_the_original_environment(self):
        ns, _ = self.load({"key": {}, "fill": {}}, refuse={"fill"})
        result = ns["op_studio_off"]({})
        self.assertEqual(result["env"], "Studio")
        self.assertEqual(list(result["failed"]), ["fill"])
        self.assertEqual(self.lux.removed, ["CC_Studio"])

    def test_studio_off_never_removes_the_environment_it_is_still_using(self):
        ns, _ = self.load({}, environments=("CC_Studio",), active="CC_Studio", prev="Animation")
        result = ns["op_studio_off"]({})
        self.assertEqual(result["env"], "CC_Studio")
        self.assertEqual(self.lux.removed, [])


REMOVE_FUNCTIONS = [node for node in TREE.body if isinstance(node, ast.FunctionDef)
                    and node.name in {"_scene_nodes", "_tree_node_ids", "_delete_created_nodes", "op_light_remove"}]


class FakeNode:
    def __init__(self, scene, node_id, name, kind="group", children=()):
        self.scene, self.id, self.name, self.kind, self.children, self.deleted = scene, node_id, name, kind, list(children), False

    def getID(self): return self.id
    def getName(self): return self.name
    def isDeleted(self): return self.deleted
    def isObject(self): return self.kind == "object"
    def isGroup(self): return self.kind == "group"
    def isCamera(self): return False
    def isAnimation(self): return False
    def getChildren(self): return [c for c in self.children if not c.deleted]
    def getParent(self): return self.scene.parent_of(self)
    def find(self, name=""):
        out = []
        def walk(n):
            for c in n.getChildren():
                out.append(c); walk(c)
        walk(self)
        return out

    def delete(self):
        self.deleted = True
        self.scene.parent_of(self).children.remove(self)   # KeyShot drops the node from the tree ...


class FakeScene:
    """KeyShot 2026.2 quirk: deleting an object node leaves its mesh ID in lux.getObjects()."""
    def __init__(self):
        self.panel = FakeNode(self, 101, "CC_L_key", "object")
        self.group = FakeNode(self, 100, "cc_light_panel", "group", [self.panel])
        self.product = FakeNode(self, 50, "Phone", "object")
        self.root = FakeNode(self, 1, "lux_root", "group", [self.product, self.group])
        self.objects = {50, 101}                            # ... but the mesh ID stays listed here
        self.materials = ["Area Light #1", "Phone paint"]

    def parent_of(self, target):
        def walk(n):
            for c in n.children:
                if c is target: return n
                found = walk(c)
                if found: return found
        return walk(self.root)

    # the lux calls the lifted functions use
    def getSceneTree(self): return self.root
    def getObjects(self): return sorted(self.objects)
    def getSceneMaterials(self): return list(self.materials)
    def sync(self): pass


class StaleMeshRemovalTests(unittest.TestCase):
    def load(self, scene, registry):
        def light_node(oid, lid=None):
            return next((n for n in scene.root.find() if n.getID() == oid and n.isObject() and n.getName().startswith("CC_L_")), None)
        ns = {"lux": scene, "REG": registry, "PREFIX": "CC_L_", "adopt_orphans": lambda: [], "_light_node": light_node,
              "_material_in_use": lambda material, exclude_ids=(): False, "_delete_unused_material": lambda material: True,
              "_scene_unit_snapshot": lambda: {"unit": "mm", "unitScale": 1000.0}}
        exec(compile(ast.Module(body=REMOVE_FUNCTIONS, type_ignores=[]), str(SOURCE), "exec"), ns)
        return ns

    def entry(self):
        return {"key": {"obj_id": 101, "mat": "Area Light #1", "mat_owned": True,
                        "created_node_ids": [100, 101], "created_geometry_ids": [101], "spec": {"type": "area"}}}

    def test_a_deleted_panel_whose_mesh_id_lingers_counts_as_removed(self):
        scene, registry = FakeScene(), self.entry()
        result = self.load(scene, registry)["op_light_remove"]({"id": "key"})
        self.assertTrue(result["removed"])
        self.assertEqual(registry, {}, "the light is released, so the next preset does not trip over it")
        self.assertEqual([n.getName() for n in scene.root.getChildren()], ["Phone"], "only the light's own nodes were deleted")

    def test_a_light_already_stuck_from_an_earlier_attempt_is_released(self):
        scene, registry = FakeScene(), self.entry()
        scene.group.delete()                              # an earlier attempt deleted the nodes; only the stale ID is left
        self.assertTrue(self.load(scene, registry)["op_light_remove"]({"id": "key"})["removed"])
        self.assertEqual(registry, {})

    def test_a_light_still_partly_in_the_tree_is_refused_not_guessed(self):
        scene, registry = FakeScene(), self.entry()
        scene.panel.name = "renamed by user"              # the panel can no longer be identified, but its group is still there
        with self.assertRaises(RuntimeError):
            self.load(scene, registry)["op_light_remove"]({"id": "key"})
        self.assertIn("key", registry)
        self.assertIn(50, scene.objects)


if __name__ == "__main__":
    unittest.main()
