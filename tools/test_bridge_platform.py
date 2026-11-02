"""The bridge loop on macOS and Windows, with the platform and every host module faked. No KeyShot, no network.

Covers the GUI-event pump in cc_bridge.py (Win32 message pump on Windows, Qt event processing on macOS, a safe no-op when
neither exists) and the launcher that install-mac.sh writes into KeyShot's Scripts folder."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
BRIDGE_SOURCE = REPO / "bridge" / "cc_bridge.py"

STUB_OPS = """
def read_camera():
    return {"eye": [0, 0, 1]}

def _boom(c):
    return 1 / 0

OPS = {"ping": lambda c: {"pong": c.get("n")}, "boom": _boom, "stop": lambda c: "bye"}
"""


def fake_lux_modules():
    return {"lux": ModuleType("lux"), "luxmath": ModuleType("luxmath")}


def fake_qt(name, calls, instance_none=False, explode=False):
    """A PySide package whose QCoreApplication.instance().processEvents() records its calls."""
    package, core = ModuleType(name), ModuleType(name + ".QtCore")

    def process_events():
        calls.append(name)
        if explode:
            raise RuntimeError("Qt is shutting down")

    app = SimpleNamespace(processEvents=process_events)
    core.QCoreApplication = SimpleNamespace(instance=lambda: None if instance_none else app)
    package.QtCore = core
    return {name: package, name + ".QtCore": core}


def fake_win32(counters):
    """ctypes with a user32 whose message queue holds three messages."""
    pending = [3]

    def peek(msg, *args):
        counters["peek"] += 1
        if pending[0] > 0:
            pending[0] -= 1
            return 1
        return 0

    user32 = SimpleNamespace(PeekMessageW=peek,
                             TranslateMessage=lambda msg: counters.__setitem__("translate", counters["translate"] + 1),
                             DispatchMessageW=lambda msg: counters.__setitem__("dispatch", counters["dispatch"] + 1))
    ctypes_module, wintypes = ModuleType("ctypes"), ModuleType("ctypes.wintypes")
    ctypes_module.windll = SimpleNamespace(user32=user32)
    ctypes_module.byref = lambda value: value
    wintypes.MSG = lambda: object()
    ctypes_module.wintypes = wintypes
    return {"ctypes": ctypes_module, "ctypes.wintypes": wintypes}


class BridgeLoopTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name) / "Key Shot Director"          # a space, as in a real user path
        (self.root / "bridge" / "cmd").mkdir(parents=True)
        shutil.copy(BRIDGE_SOURCE, self.root / "bridge" / "cc_bridge.py")
        (self.root / "bridge" / "cc_ops.py").write_text(STUB_OPS, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def queue(self, *commands):
        for index, command in enumerate(commands):
            (self.root / "bridge" / "cmd" / ("%02d_%s.json" % (index, command["op"]))).write_text(json.dumps(command), encoding="utf-8")

    def run_bridge(self, os_name, modules, source=None):
        text = source if source is not None else (self.root / "bridge" / "cc_bridge.py").read_text(encoding="utf-8-sig")
        merged = dict(fake_lux_modules())
        merged.update(modules)
        namespace = {"KD_HOME": str(self.root)}
        with mock.patch.dict(sys.modules, merged), mock.patch.object(os, "name", os_name), contextlib.redirect_stdout(io.StringIO()) as out:
            exec(compile(text, str(self.root / "bridge" / "cc_bridge.py"), "exec"), namespace)
        return namespace, out.getvalue()

    def responses(self):
        resp = self.root / "bridge" / "resp"
        return {path.stem[3:]: json.loads(path.read_text(encoding="utf-8")) for path in resp.glob("*.json")}

    def assert_loop_worked(self):
        answers = self.responses()
        self.assertEqual(answers["ping"]["result"], {"pong": 7})
        self.assertFalse(answers["boom"]["ok"])
        self.assertIn("ZeroDivisionError", answers["boom"]["error"])
        self.assertTrue(answers["stop"]["ok"])
        heartbeat = json.loads((self.root / "bridge" / "heartbeat.json").read_text(encoding="utf-8"))
        self.assertEqual(heartbeat["state"], "stopped")
        self.assertEqual(json.loads((self.root / "bridge" / "initial_camera.json").read_text(encoding="utf-8")), {"eye": [0, 0, 1]})
        self.assertEqual([p.name for p in (self.root / "bridge" / "cmd").iterdir()], [], "every command is claimed and removed")

    def test_macos_pumps_qt_events_between_commands(self):
        calls = []
        self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
        self.run_bridge("posix", {**fake_qt("PySide6", calls), "PySide2": None})
        self.assert_loop_worked()
        self.assertGreaterEqual(len(calls), 2, "events are processed before and after the command scan")
        self.assertEqual(set(calls), {"PySide6"})

    def test_macos_falls_back_to_pyside2(self):
        calls = []
        self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
        self.run_bridge("posix", {"PySide6": None, **fake_qt("PySide2", calls)})
        self.assert_loop_worked()
        self.assertEqual(set(calls), {"PySide2"})

    def test_macos_without_qt_still_runs_with_no_pump(self):
        self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
        namespace, _ = self.run_bridge("posix", {"PySide6": None, "PySide2": None})
        self.assert_loop_worked()
        self.assertIsNone(namespace["_qt_core"])
        self.assertIsNone(namespace["_user32"])

    def test_macos_survives_a_missing_or_failing_qt_application(self):
        for modules in (fake_qt("PySide6", [], instance_none=True), fake_qt("PySide6", [], explode=True)):
            with self.subTest(modules=list(modules)):
                for path in (self.root / "bridge" / "resp").glob("*") if (self.root / "bridge" / "resp").exists() else []:
                    path.unlink()
                self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
                self.run_bridge("posix", {**modules, "PySide2": None})
                self.assert_loop_worked()

    def test_windows_still_drains_the_win32_message_queue(self):
        counters = {"peek": 0, "translate": 0, "dispatch": 0}
        self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
        namespace, _ = self.run_bridge("nt", fake_win32(counters))
        self.assert_loop_worked()
        self.assertEqual((counters["translate"], counters["dispatch"]), (3, 3))
        self.assertGreater(counters["peek"], 3)
        self.assertIsNone(namespace["_qt_core"], "the Windows build must not touch Qt")

    def test_install_mac_launcher_runs_the_bridge_from_a_folder_with_spaces(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        scripts = Path(self.dir.name) / "KeyShot 2026" / "Scripts"
        done = subprocess.run([node, str(REPO / "tools" / "install-launcher.js"), str(self.root), "--scripts-folder", str(scripts)],
                              capture_output=True, text=True, check=True)
        self.assertIn("launcher installed", done.stdout)
        launcher = scripts / "KeyShot Director.py"
        text = launcher.read_text(encoding="utf-8")
        self.assertIn("# AUTHOR KeyShot Director", text)
        self.queue({"op": "ping", "n": 7}, {"op": "boom"}, {"op": "stop"})
        # KeyShot runs the launcher without KD_HOME defined; the launcher defines it itself.
        namespace = {}
        with mock.patch.dict(sys.modules, {**fake_lux_modules(), "PySide6": None, "PySide2": None}), mock.patch.object(os, "name", "posix"), \
                contextlib.redirect_stdout(io.StringIO()):
            exec(compile(text, str(launcher), "exec"), namespace)
        self.assertEqual(namespace["KD_HOME"], str(self.root))
        self.assert_loop_worked()

    def test_launcher_reports_a_moved_install(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        scripts = Path(self.dir.name) / "Scripts"
        subprocess.run([node, str(REPO / "tools" / "install-launcher.js"), str(self.root), "--scripts-folder", str(scripts)], capture_output=True, text=True, check=True)
        shutil.rmtree(self.root)
        with self.assertRaisesRegex(Exception, "was moved or deleted"):
            exec(compile((scripts / "KeyShot Director.py").read_text(encoding="utf-8"), "launcher", "exec"), {})

    def test_connect_line_survives_quotes_in_the_install_path(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        for folder in ("/Users/ben/Documents/KeyShot Director", "/Users/ben/Ben's Files/KeyShot Director", '/Users/ben/The "Big" Folder/KD'):
            with self.subTest(folder=folder):
                code = "process.stdout.write(require(process.argv[1]).connectLine(process.argv[2]))"
                line = subprocess.run([node, "-e", code, str(REPO / "server" / "platform.js"), folder], capture_output=True, text=True, check=True).stdout
                opened = []

                class Source:
                    def read(self):
                        return "RAN = True"

                def fake_open(path, *args, **kwargs):
                    opened.append(path)
                    return Source()

                namespace = {"open": fake_open}
                exec(compile(line, "console", "exec"), namespace)
                self.assertTrue(namespace["RAN"])
                expected = os.path.abspath(folder).replace(os.sep, "/") if os.name == "nt" else folder
                self.assertEqual(namespace["KD_HOME"], expected)
                self.assertEqual(opened, [expected + "/bridge/cc_bridge.py"])


if __name__ == "__main__":
    unittest.main()
