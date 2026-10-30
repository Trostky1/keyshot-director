"""Isolated tests for the explicit native-save bridge operation; a fake lux, no KeyShot, no network."""
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


class SceneSaveTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.scene = os.path.join(self.dir.name, "Product.bip")
        Path(self.scene).write_text("original scene")
        self.calls = []
        self.state = {"file": self.scene, "write": True, "retarget": False}

        def write(path):
            if self.state["write"]:
                Path(path).write_text("saved bytes")

        def save_file(path):
            self.calls.append(("saveFile", path)); write(path)
            if self.state["retarget"]:
                self.state["file"] = path

        def save_package(path):
            self.calls.append(("savePackage", path)); write(path)

        self.lux = SimpleNamespace(getSceneInfo=lambda: {"file": self.state["file"]}, saveFile=save_file, savePackage=save_package)
        source = Path(__file__).resolve().parents[1] / "bridge" / "cc_deliver.py"
        self.ns = dict(os=os, lux=self.lux)
        exec(compile(source.read_text(encoding="utf-8-sig"), str(source), "exec"), self.ns)
        self.save = self.ns["op_scene_save"]

    def tearDown(self):
        self.dir.cleanup()

    def path(self, name):
        return os.path.join(self.dir.name, name)

    def test_registered_and_inputs_validated(self):
        self.assertIn("scene_save", self.ns["DELIVER_OPS"])
        with self.assertRaisesRegex(ValueError, "unsupported"):
            self.save({"ksp": self.path("a.ksp"), "overwrite": True})
        with self.assertRaisesRegex(ValueError, "choose a bip"):
            self.save({})
        self.assertEqual(self.calls, [])

    def test_paths_must_be_new_absolute_and_correctly_named(self):
        existing = self.path("exists.ksp"); Path(existing).write_text("x")
        for bad, message in ((("ksp", "relative.ksp"), "absolute"), (("ksp", self.path("a.zip")), "end in .ksp"),
                             (("bip", self.path("a.ksp")), "end in .bip"), (("ksp", existing), "never overwrites"),
                             (("ksp", os.path.join(self.dir.name, "missing", "a.ksp")), "does not exist"),
                             (("bip", self.scene), "never overwrites")):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, message):
                self.save({bad[0]: bad[1]})
        self.assertEqual(self.calls, [], "nothing is written when validation fails")

    def test_current_scene_file_is_never_a_target(self):
        self.state["file"] = self.path("Open.bip")        # a scene whose file does not exist yet on disk
        with self.assertRaisesRegex(ValueError, "currently open scene"):
            self.save({"bip": self.path("Open.bip")})

    def test_package_is_written_before_the_scene_and_files_are_verified(self):
        result = self.save({"bip": self.path("look.bip"), "ksp": self.path("look.ksp")})
        self.assertEqual([c[0] for c in self.calls], ["savePackage", "saveFile"])
        self.assertEqual(result["saved"], ["ksp", "bip"]); self.assertTrue(all(f["bytes"] > 0 for f in result["files"].values()))
        self.assertFalse(result["open_scene_retargeted"]); self.assertIn("not been verified", result["note"])

    def test_retargeting_the_open_scene_is_reported(self):
        self.state["retarget"] = True
        result = self.save({"bip": self.path("look.bip")})
        self.assertTrue(result["open_scene_retargeted"]); self.assertEqual(result["scene_file_after"], "look.bip")
        self.assertEqual(result["scene_file_before"], "Product.bip")

    def test_unsaved_scene_and_silent_failure(self):
        self.state["file"] = ""
        self.assertEqual(self.save({"ksp": self.path("a.ksp")})["scene_file_before"], None)
        self.state["write"] = False
        with self.assertRaisesRegex(RuntimeError, "non-empty"):
            self.save({"ksp": self.path("b.ksp")})


if __name__ == "__main__":
    unittest.main()
