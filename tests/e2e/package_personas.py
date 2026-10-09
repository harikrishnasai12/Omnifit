"""
Package a persona recording (results/personas/personas.json) for the
"Persona Journeys" web page: copies the screenshots, downloads the product
photos shown in the feeds and stories (the page can only use its own files),
and writes a compact data.json.

Usage (with the backend venv):
    python tests/e2e/package_personas.py <output folder>
"""

import hashlib
import json
import shutil
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "results" / "personas"
ALLOWED_IMAGE_HOSTS = ("cdn.shopify.com",)


def main(out: Path) -> None:
    run = json.loads((SOURCE / "personas.json").read_text(encoding="utf-8"))
    (out / "shots").mkdir(parents=True, exist_ok=True)
    (out / "img").mkdir(parents=True, exist_ok=True)

    images: dict[str, str] = {}
    client = httpx.Client(timeout=20, follow_redirects=False)

    def local_image(url):
        if not url or not url.startswith("https://") or httpx.URL(url).host not in ALLOWED_IMAGE_HOSTS:
            return None
        if url not in images:
            name = hashlib.sha1(url.encode()).hexdigest()[:12] + ".jpg"
            target = out / "img" / name
            if not target.exists():
                try:
                    response = client.get(url)
                    if response.status_code != 200 or not response.headers.get("content-type", "").startswith("image/"):
                        return None
                    target.write_bytes(response.content)
                except httpx.HTTPError:
                    return None
            images[url] = f"img/{name}"
        return images[url]

    for persona in run["personas"]:
        # The e-mail of the throwaway account is not needed on the page
        persona.pop("account", None)
        for step in persona["steps"]:
            if step.get("screenshot"):
                shutil.copy(SOURCE / step["screenshot"], out / "shots" / step["screenshot"])
                step["screenshot"] = f"shots/{step['screenshot']}"
            outcome = step.get("outcome", {})
            for key in ("feed", "after_love_on_device"):
                for card in outcome.get(key, []) or []:
                    card["image"] = local_image(card.get("image"))
            for story in outcome.get("stories", []) or []:
                story["cover"] = local_image(story.get("cover"))

    (out / "data.json").write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
    print(f"{len(images)} product photos, data.json {len((out / 'data.json').read_bytes()) // 1024} KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
