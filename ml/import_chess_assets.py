"""Extract the three user-supplied CC-BY chess packs without executing archive contents."""
import argparse
import json
import zipfile
from pathlib import Path

PACKS = ("chess_kit", "chess_set", "wooden_chess_set")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.home() / "Desktop")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "assets")
    args = parser.parse_args()
    credits = []
    for name in PACKS:
        target = (args.out / name).resolve()
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.source / f"{name}.zip") as archive:
            for member in archive.infolist():
                if not (target / member.filename).resolve().is_relative_to(target):
                    raise ValueError(f"Unsafe archive path: {member.filename}")
            archive.extractall(target)
        model = json.loads((target / "scene.gltf").read_text())
        credits.append((target / "license.txt").read_text())
        print(f"{name}: {len(model['meshes'])} meshes")
    (args.out / "ATTRIBUTION.md").write_text("# Chess training assets\n\n" + "\n\n".join(credits))

if __name__ == "__main__":
    main()
