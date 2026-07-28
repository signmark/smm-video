---
name: web-scraping-and-anti-bot-bypass
description: Advanced strategies for scraping, crawling, and bypassing modern anti-bot protection systems (Cloudflare Turnstile, Akamai, Datadome, Kittenx) using Puppeteer, stealth plugins, and cookie/User-Agent alignment.
version: 1.1.0
category: software-development
tags: [scraping, puppeteer, stealth, cloudflare, cookies, bypass, vk]
---

# Web Scraping & Anti-Bot Evasion (Cloudflare / Turnstile / Kittenx)

## Overview

Modern anti-bot systems (like Cloudflare Turnstile, Datadome, Akamai, and VK's Kittenx) analyze the client on multiple layers: HTTP headers, TLS fingerprint (JA3/JA4), browser fingerprinting (canvas, WebGL, navigator object), and behavioral heuristics. Bypassing them requires strict consistency across all layers. This skill covers advanced evasion strategies, cookie alignment, headful/headless virtual display setups, and human-like interaction flows.

---

## Core Principles

### 1. Cookies are Cryptographically Bound to the Browser Fingerprint and IP
A common mistake is copying a clearance cookie (like `cf_clearance`) from a desktop browser into Puppeteer and expecting it to work.
* **The Rule**: `cf_clearance` is bound to the **IP address** AND the **User-Agent / TLS Fingerprint** of the client that solved the challenge.
* **The Fix**: The automated browser's User-Agent **MUST exactly match** the User-Agent of the browser where the cookie was generated (including major/minor Chrome/Edge versions, e.g., `Chrome/148.0.0.0`). Any mismatch will cause Cloudflare to immediately discard the cookie and trigger a re-challenge.
* **WSL 2 IP Pitfall**: If you are using WSL 2, the outbound network interface might route through a different VPN/routing adapter than your host Windows Chrome. If the external IP of WSL (test via `curl api.ipify.org`) does not match the external IP of Windows, Cloudflare will instantly invalidate `cf_clearance` due to IP-binding mismatch. Ensure VPN setups or local network routing match exactly on both host and VM.
* **Windows Host Chrome Connection Workaround**: Instead of running a headless browser inside WSL with imported cookies, connect Puppeteer directly to your active Windows Chrome:
  1. Kill Windows Chrome tasks: `taskkill.exe /F /IM chrome.exe`.
  2. Launch Windows Chrome in debugging mode: `chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:/temp/chrome_dev_profile"`. (Using forward slashes `/` in `--user-data-dir` prevents bash from treating `\t` as a tab character in Windows paths).
  3. Connect Puppeteer from WSL to Windows: `puppeteer.connect({ browserURL: 'http://172.22.224.1:9222' })` (where `172.22.224.1` is your standard WSL 2 Windows host adapter IP). This inherits your full Windows session, GPU fingerprint, and local IP seamlessly.

### 2. Header and Feature Consistency
Anti-bots look for contradictions. If `navigator.userAgent` says Windows, but `navigator.platform` says `Linux x86_64` (typical of WSL), or the TLS handshake signature matches Linux Chrome, you will be flagged as a bot.
* **The Rule**: Avoid manually overriding `page.setUserAgent()` unless you are matching a specific cookie and can also spoof the matching platform, plugins, and WebGL specs.
* **The Fix**: Let `puppeteer-extra-plugin-stealth` manage the User-Agent and fingerprint parameters automatically whenever possible. It strips headless flags and aligns browser variables.

### 3. Direct Deep-Link Triggers
Directly navigating a headless browser to a highly protected deep page (like `/stat/ads-efficiency` or `/export/data`) triggers aggressive security rules.
* **The Rule**: Human users don't bookmark and directly request deep API endpoints in empty sessions.
* **The Fix**: Use **Multi-Step Human Navigation**:
  1. Navigate to the main homepage (`/`).
  2. Wait for a natural delay (2-4 seconds).
  3. Navigate to a mid-level public page (e.g., `/channel/@mash/stat`).
  4. Programmatically find the target link element in the DOM and trigger a click: `(targetLink as any).click()`. This automatically populates the correct `Referer` headers and mimics real traffic patterns.
* **404 vs Anti-Bot Block**: Ensure you are requesting the correct URL format (e.g. `/stat/ads-efficiency` instead of `/stat/efficiency` which returns a 404). Do not confuse a 404 Page Not Found with an anti-bot Cloudflare block.


---

## Evasion Workflows

### Scenario A: Reusing Host Browser Cookies (Local/WSL)
When running inside WSL or local container environments sharing the same router/NAT (same outgoing public IP):

1. **Export with HttpOnly**: Export cookies from your logged-in desktop session. Ensure your exporter tool is configured to **Include HttpOnly** cookies (such as `cf_clearance`).
2. **Retrieve your User-Agent**: Extract your exact desktop browser User-Agent (e.g., from `whatsmyua.info`).
3. **Load and Align in Puppeteer**:
   ```typescript
   const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
   const page = await browser.newPage();
   
   // Set the EXACT User-Agent that generated the cookies
   await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
   
   // Inject all cookies
   await page.setCookie(...cookies);
   ```

### Scenario B: Virtual Desktop (Xvfb) for True Headful Evasion
Headless Chrome lacks WebGL, codecs, and triggers specific system flags. Running Chrome in **headful mode** (`headless: false`) behind a virtual display completely hides headless indicators.

1. **Configure Puppeteer for Headful**:
   ```typescript
   const browser = await puppeteer.launch({
     headless: false, // Run in headful mode!
     args: [
       '--no-sandbox',
       '--disable-setuid-sandbox',
       '--disable-dev-shm-usage',
       '--disable-blink-features=AutomationControlled' // Strip automation flag
     ]
   });
   ```
2. **Run under Xvfb** (Virtual Framebuffer):
   Install `xvfb` and `xauth` on your Linux host:
   ```bash
   apt-get install -y xvfb xauth
   ```
   Execute your Node/Python script under Xvfb:
   ```bash
   xvfb-run --server-args="-screen 0 1280x800x24" npx tsx your-script.ts
   ```

---

## Target-Specific Evasion & Parsing Tricks

### 1. VK.com (Kittenx Evasion & Windows-1251 Decoding)
VK's load balancer and DDoS shield (`Kittenx`) aggressively blocks headless or automated requests that lack browser-like headers with an `HTTP 418` (I'm a teapot) code.

* **Bypass Rule**: Always supply a valid modern browser `User-Agent` and standard `Accept` / `Accept-Language` headers when calling public VK.com pages or profiles.
* **Encoding Pitfall**: VK's prefetch data block (`window.cur.apiPrefetchCache`) is delivered in **`windows-1251` (cp1251)** encoding, not UTF-8. Parsing the response as standard UTF-8 (or using `errors='ignore'`) will completely remove or mangle all Cyrillic characters.
* **The Fix**: Always decode the raw response body bytes explicitly as `windows-1251` (or `cp1251`) before extracting content.
* **Mobile Dynamic Loading Pitfall**: Attempting to crawl the mobile version (`m.vk.com`) via a simple static `curl` to avoid JS complexity will fail because mobile VK loads all wall posts dynamically using client-side JavaScript. The static HTML will contain an empty `<div id="mcont">` container. Stick to parsing the desktop site prefetch cache or use a headful browser with dynamic rendering.
* **Example (Python)**:
  ```python
  import requests
  import json
  import re

  headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
  }
  response = requests.get("https://vk.com/onsitnov", headers=headers)
  html_decoded = response.content.decode("windows-1251", errors="ignore")

  # Extract prefetch cache or JSON groups block
  group_match = re.search(r'"id":181642819,"description":"(.*?)"', html_decoded)
  # Process safely with json decoding for unicode escapes
  ```

---

## Directus Schema/Fields Management (Programmatic)

When adding data fields to a Directus collection during scraping/pipeline setup:
* Never use normal collection-specific user tokens to add fields — these usually lack schema mutation rights and return `401 Unauthorized (INVALID_CREDENTIALS)`.
* Always use the **`/fields/<collection>`** system endpoint with the **`DIRECTUS_ADMIN_TOKEN`** (or by sourcing credentials from the host's `/root/.env` or docker-compose environment variables).
