from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET


ANDROID_NS = "http://schemas.android.com/apk/res/android"
ANDROID = f"{{{ANDROID_NS}}}"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ANDROID_PROJECT = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else PROJECT_ROOT / "src-tauri" / "gen" / "android"
)
MANIFEST = ANDROID_PROJECT / "app" / "src" / "main" / "AndroidManifest.xml"
PLUGIN_SOURCE = (
    PROJECT_ROOT
    / "src-tauri"
    / "android"
    / "plugin"
    / "src"
    / "main"
    / "java"
    / "dev"
    / "droothe"
    / "ddm"
    / "ShareIntentPlugin.kt"
)
PLUGIN_DESTINATION = (
    ANDROID_PROJECT
    / "app"
    / "src"
    / "main"
    / "java"
    / "dev"
    / "droothe"
    / "ddm"
    / "ShareIntentPlugin.kt"
)


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def register_namespaces() -> None:
    for _, (prefix, uri) in ET.iterparse(MANIFEST, events=("start-ns",)):
        if prefix == "ns" or (prefix.startswith("ns") and prefix[2:].isdigit()):
            continue
        ET.register_namespace(prefix, uri)


def prepare_manifest() -> None:
    if not MANIFEST.is_file():
        fail(f"Generated Android manifest not found: {MANIFEST}")

    register_namespaces()
    tree = ET.parse(MANIFEST)
    root = tree.getroot()
    activity = next(
        (
            element
            for element in root.findall(".//activity")
            if any(
                action.get(ANDROID + "name") == "android.intent.action.MAIN"
                for action in element.findall(".//action")
            )
        ),
        None,
    )
    if activity is None:
        fail("Could not locate the launcher activity in AndroidManifest.xml.")

    activity.set(ANDROID + "launchMode", "singleTask")
    has_share_filter = any(
        action.get(ANDROID + "name") == "android.intent.action.SEND"
        for action in activity.findall(".//action")
    )
    if not has_share_filter:
        intent_filter = ET.SubElement(activity, "intent-filter")
        ET.SubElement(
            intent_filter,
            "action",
            {ANDROID + "name": "android.intent.action.SEND"},
        )
        ET.SubElement(
            intent_filter,
            "category",
            {ANDROID + "name": "android.intent.category.DEFAULT"},
        )
        ET.SubElement(
            intent_filter,
            "data",
            {ANDROID + "mimeType": "text/plain"},
        )

    ET.indent(tree, space="    ")
    tree.write(MANIFEST, encoding="utf-8", xml_declaration=True)


def install_share_plugin() -> None:
    if not PLUGIN_SOURCE.is_file():
        fail(f"Android share plugin source not found: {PLUGIN_SOURCE}")
    PLUGIN_DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PLUGIN_SOURCE, PLUGIN_DESTINATION)


if __name__ == "__main__":
    prepare_manifest()
    install_share_plugin()
    print("Android manifest and native share/media plugin are ready.")
