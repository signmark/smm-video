# SOCKS5 Proxy — Docker Compose Setup

Works on Hetzner / any Linux VPS. Provides an authenticated SOCKS5 proxy accessible
locally (`127.0.0.1:51080`) or externally (public IP) to bypass geo‑blocks and IP
restrictions for tools like `youtube-transcript-api`, `yt-dlp`, and browser automation.

## Which Image Works

| Image | Auth Support | Verdict |
|-------|-------------|---------|
| `xkuma/socks5:latest` | `PROXY_USER` + `PROXY_PASS` env vars | ✅ **Use this** |
| `serjs/go-socks5-proxy:latest` | Claims `PROXY_USER`/`PROXY_PASSWORD` but auth fails in practice | ❌ Skip |

## docker-compose.yml

```yaml
services:
  socks5:
    image: xkuma/socks5:latest
    container_name: socks5-proxy
    restart: unless-stopped
    ports:
      - "0.0.0.0:51080:1080"
    environment:
      PROXY_USER: your_username
      PROXY_PASS: your_password
    networks:
      - socks_net

networks:
  socks_net:
    driver: bridge
```

## Firewall

```bash
ufw allow 51080/tcp
```

## Verify

```bash
# Local test
curl -x socks5h://user:pass@127.0.0.1:51080 -s https://api.ipify.org
# External test (from WSL/Windows)
curl -x socks5h://user:pass@SERVER_IP:51080 -s https://api.ipify.org
# Both should return the server's public IP
```

## Client Usage

```bash
# youtube-transcript-api
python3 fetch_transcript.py "URL" --proxy "socks5h://user:pass@127.0.0.1:51080"

# Shell env (WSL clients connecting to remote proxy)
export ALL_PROXY="socks5h://user:pass@SERVER_IP:51080"

# Python
session.proxies = {
    "http": "socks5h://user:pass@127.0.0.1:51080",
    "https": "socks5h://user:pass@127.0.0.1:51080"
}
```

## Pitfall: When NOT to Use

If your API provider (e.g. OmniRoute at `omni.zhdanov.pw`) is already hosted on an
external EU server that bypasses geo‑blocks, **do not** route it through a SOCKS5 proxy.
Doing so creates a proxy loop: `localhost → proxy → server → API` where the proxy hop
is unnecessary and introduces connection errors (`APIConnectionError`). Use SOCKS5 only
for tools that need to appear as a residential/non‑cloud IP.
