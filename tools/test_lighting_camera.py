"""Isolated camera-metadata tests; no KeyShot imports or live commands."""
import ast
import copy
import math
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "bridge" / "cc_lights.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"))
FUNCTION = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "_lighting_camera_observation")


class CameraEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.lens = {"lens_type": "Perspective", "lens_parameters": {"perspective": True, "shift": [0, 0], "fov": 35}}
        self.context = {"math": math, "op_scene_context": lambda _: {"camera": self.lens}}
        exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(SOURCE), "exec"), self.context)
        self.observe = self.context["_lighting_camera_observation"]
        self.pose = {key: [0, 0, 1] for key in ("pos", "pivot", "dir", "lookat", "up")}
        self.pose.update({"dist": 2, "fov": 35, "focal": 50})

    def test_complete_pose_and_lens_are_observed(self):
        self.assertIsNotNone(self.observe(self.pose))

    def test_failed_pose_getters_and_nonfinite_values_fail_closed(self):
        for key, value in (("pos", "ERR unavailable"), ("fov", "ERR unavailable"), ("focal", float("nan")), ("up", [0, 0, float("inf")])):
            with self.subTest(key=key):
                self.assertIsNone(self.observe({**self.pose, key: value}))

    def test_missing_or_unreadable_lens_shift_fails_closed(self):
        self.lens = {"lens_type": "Perspective"}
        self.assertIsNone(self.observe(self.pose))
        self.lens["lens_parameters"] = {"shift": "ERR unavailable"}
        self.assertIsNone(self.observe(self.pose))

    def test_lens_shift_and_projection_change_the_observation(self):
        original = copy.deepcopy(self.observe(self.pose))
        self.lens["lens_parameters"]["shift"] = [0.01, 0]
        self.assertNotEqual(original, self.observe(self.pose))
        self.lens["lens_type"] = "Orthographic"
        self.assertNotEqual(original, self.observe(self.pose))


if __name__ == "__main__":
    unittest.main()
