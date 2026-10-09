"""
Turn a shared social link into a preview image for the Style Library.

Only an allowlist of hosts is ever fetched (checked again after every
redirect), so user-supplied links can't make the server reach internal or
arbitrary addresses.

Supported:
- YouTube (videos, Shorts): public oEmbed -> thumbnail + title
- Pinterest (pins, pin.it short links): the pin page's og:image
Not supported: Instagram, Facebook and similar, which block reading posts
without login; users share a screenshot instead.
"""

import re
from html import unescape
from typing import Optional
from urllib.parse import quote, urlparse

import httpx

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 5

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
PINTEREST_PAGE_HOSTS = re.compile(r"^([a-z]{2,3}\.)?(www\.)?pinterest\.[a-z.]{2,6}$|^pin\.it$")
IMAGE_HOSTS = re.compile(r"^(i\.ytimg\.com|img\.youtube\.com|i\.pinimg\.com)$")
LOGIN_ONLY_HOSTS = re.compile(r"(^|\.)(instagram\.com|facebook\.com|fb\.watch|threads\.net|tiktok\.com)$")

USER_AGENT = "OmniFitLive/1.0 (Style Library preview)"


class LinkError(Exception):
    """A problem with the link the user should see."""


def platform_for(url: str) -> Optional[str]:
    host = (urlparse(url).hostname or "").lower()

    if host in YOUTUBE_HOSTS:
        return "youtube"
    if PINTEREST_PAGE_HOSTS.match(host):
        return "pinterest"
    if LOGIN_ONLY_HOSTS.search(host):
        return "login_only"

    return None


def _check_url(url: str, allowed) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if parsed.scheme != "https" or not host or parsed.port not in (None, 443):
        raise LinkError("Only https links from YouTube or Pinterest can be added.")

    if not allowed(host):
        raise LinkError("This link isn't supported. Share a screenshot instead.")

    return url


async def _get(client: httpx.AsyncClient, url: str, allowed, max_bytes: int) -> httpx.Response:
    # Follow redirects manually so every hop is checked against the allowlist
    for _ in range(MAX_REDIRECTS + 1):
        _check_url(url, allowed)

        response = await client.get(
            url, headers={"User-Agent": USER_AGENT}, follow_redirects=False, timeout=15.0
        )

        if response.is_redirect:
            url = str(response.next_request.url) if response.next_request else ""
            continue

        response.raise_for_status()

        if len(response.content) > max_bytes:
            raise LinkError("That preview is too large to save.")

        return response

    raise LinkError("That link redirects too many times.")


def _page_allowed(host: str) -> bool:
    return host in YOUTUBE_HOSTS or bool(PINTEREST_PAGE_HOSTS.match(host))


def _image_allowed(host: str) -> bool:
    return bool(IMAGE_HOSTS.match(host))


def _meta_content(html: str, prop: str) -> Optional[str]:
    for pattern in (
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
    ):
        match = re.search(pattern, html, re.I)
        if match:
            return unescape(match.group(1))

    return None


async def fetch_link_preview(client: httpx.AsyncClient, url: str) -> dict:
    """Returns {"platform", "title", "image_bytes", "source_url"} or raises LinkError."""
    url = (url or "").strip()
    platform = platform_for(url)

    if platform == "login_only":
        raise LinkError(
            "Instagram and similar apps don't allow other apps to read posts. "
            "Take a screenshot of the look and add that instead."
        )

    if platform is None:
        raise LinkError("Only YouTube and Pinterest links can be added. For other apps, share a screenshot.")

    try:
        if platform == "youtube":
            oembed = await _get(
                client,
                f"https://www.youtube.com/oembed?format=json&url={quote(url, safe='')}",
                _page_allowed,
                MAX_PAGE_BYTES,
            )
            data = oembed.json()
            title = data.get("title")
            image_url = (data.get("thumbnail_url") or "").replace("hqdefault", "maxresdefault")
            fallback_image_url = data.get("thumbnail_url")
        else:
            page = await _get(client, url, _page_allowed, MAX_PAGE_BYTES)
            html = page.text
            title = _meta_content(html, "og:title")
            image_url = _meta_content(html, "og:image")
            fallback_image_url = None
            url = str(page.url)

        if not image_url:
            raise LinkError("Couldn't find a picture in that link. Share a screenshot instead.")

        try:
            image = await _get(client, image_url, _image_allowed, MAX_IMAGE_BYTES)
        except (httpx.HTTPStatusError, LinkError):
            if not fallback_image_url:
                raise
            image = await _get(client, fallback_image_url, _image_allowed, MAX_IMAGE_BYTES)

    except httpx.HTTPStatusError:
        raise LinkError("That link couldn't be opened. It may be private or deleted.")
    except (httpx.HTTPError, ValueError):
        raise LinkError("Couldn't reach that site right now. Try again or share a screenshot.")

    return {
        "platform": platform,
        "title": (title or "").strip()[:200] or None,
        "image_bytes": image.content,
        "source_url": url,
    }
