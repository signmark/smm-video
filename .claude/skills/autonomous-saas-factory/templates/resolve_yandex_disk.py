#!/usr/bin/env python3
"""
Yandex.Disk Public Link Resolver

Resolves public Yandex.Disk sharing links (e.g., https://disk.yandex.ru/i/...) 
to direct download URLs using Yandex's official public API.
Zero dependencies (standard library only).
"""

import urllib.request
import urllib.parse
import json
import sys


def resolve_yandex_disk_link(public_url: str) -> str:
    """
    Resolves a public Yandex.Disk sharing link to a direct download URL.
    """
    api_url = "https://cloud-api.yandex.net/v1/disk/public/resources/download"
    encoded_url = urllib.parse.quote_plus(public_url)
    request_url = f"{api_url}?public_key={encoded_url}"

    try:
        req = urllib.request.Request(
            request_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                return data.get("href", "")
            else:
                raise Exception(f"HTTP Error {response.status}")
    except Exception as e:
        print(f"Error resolving link: {e}", file=sys.stderr)
        return ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <yandex_disk_public_url>", file=sys.stderr)
        sys.exit(1)

    pub_url = sys.argv[1]
    direct_url = resolve_yandex_disk_link(pub_url)
    if direct_url:
        print(direct_url)
    else:
        sys.exit(1)
