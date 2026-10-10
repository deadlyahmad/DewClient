import os
import shutil


def sync_brand_icon():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    canonical_icon = os.path.join(root_dir, "icon", "DewClient.ico")
    targets = [
        os.path.join(root_dir, "website", "favicon.ico"),
        os.path.join(root_dir, "server", "public", "favicon.ico")
    ]

    for target in targets:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(canonical_icon, target)
        print(f"Synced: {target}")


if __name__ == "__main__":
    sync_brand_icon()
