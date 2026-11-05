import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ANDROID_NS = "http://schemas.android.com/apk/res/android"
ANDROID = f"{{{ANDROID_NS}}}"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREPARE_SCRIPT = PROJECT_ROOT / "src-tauri" / "android" / "prepare_android.py"


class PrepareAndroidTest(unittest.TestCase):
    def test_manifest_merge_and_plugin_copy_are_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            android_project = Path(temporary_directory) / "android"
            manifest = android_project / "app" / "src" / "main" / "AndroidManifest.xml"
            manifest.parent.mkdir(parents=True)

            root = ET.Element("manifest", {"xmlns:android": ANDROID_NS})
            application = ET.SubElement(root, "application")
            activity = ET.SubElement(
                application,
                "activity",
                {ANDROID + "name": ".MainActivity", ANDROID + "exported": "true"},
            )
            launcher = ET.SubElement(activity, "intent-filter")
            ET.SubElement(
                launcher,
                "action",
                {ANDROID + "name": "android.intent.action.MAIN"},
            )
            ET.ElementTree(root).write(manifest, encoding="utf-8", xml_declaration=True)

            for _ in range(2):
                subprocess.run(
                    [sys.executable, str(PREPARE_SCRIPT), str(android_project)],
                    check=True,
                )

            prepared_root = ET.parse(manifest).getroot()
            prepared_activity = prepared_root.find(".//activity")
            self.assertIsNotNone(prepared_activity)
            self.assertEqual(prepared_activity.get(ANDROID + "exported"), "true")
            self.assertEqual(prepared_activity.get(ANDROID + "launchMode"), "singleTask")
            share_filters = [
                intent_filter
                for intent_filter in prepared_activity.findall("intent-filter")
                if any(
                    action.get(ANDROID + "name") == "android.intent.action.SEND"
                    for action in intent_filter.findall("action")
                )
            ]
            self.assertEqual(len(share_filters), 1)
            self.assertTrue(
                any(
                    category.get(ANDROID + "name") == "android.intent.category.DEFAULT"
                    for category in share_filters[0].findall("category")
                )
            )
            self.assertTrue(
                any(
                    data.get(ANDROID + "mimeType") == "text/plain"
                    for data in share_filters[0].findall("data")
                )
            )
            self.assertTrue(
                (
                    android_project
                    / "app"
                    / "src"
                    / "main"
                    / "java"
                    / "dev"
                    / "droothe"
                    / "ddm"
                    / "ShareIntentPlugin.kt"
                ).is_file()
            )


if __name__ == "__main__":
    unittest.main()
