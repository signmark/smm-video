# WSL and Multi-Host System Diagnostics

This reference document provides concrete recipes, workarounds, and commands for troubleshooting issues specific to WSL (Windows Subsystem for Linux) environments and multi-host integrations (such as local development concurrent with remote server deployment).

---

## 1. WSL Process Persistence and Zombie Sessions

### The Symptom
After a system reboot, power outage, or Windows hibernate/resume, old agent CLI or gateway sessions might still be alive and actively running in the background. WSL 2 often hibernates/restores process states, preserving stale processes (e.g., polling a Telegram bot).

### Diagnostic Steps
Always check if older processes are running before spawning new ones:

```bash
# List all active python, hermes, or gateway processes on WSL
ps aux | grep -i -E "hermes|gateway|python" | grep -v grep
```

If old sessions are present (with timestamps from previous days), clean them up to release locks and prevent polling conflicts:

```bash
# Terminate the stale PID
kill -9 <PID>
```

---

## 2. Windows-WSL Shared Filesystem (DrvFs) Performance & Git Hangs

### The Symptom
Running `git status` or scanning files in directories mounted from Windows (under `/mnt/c/`, `/mnt/g/`, etc.) hangs, timeouts (e.g., exceeding 60s), or is extremely slow. This is because DrvFs filesystem metadata synchronization is significantly slower than native ext4.

### The Workaround
To check file modifications without scanning the entire `node_modules` or thousands of untracked files:

1. **Skip Untracked Files:** Use the `-uno` flag which dramatically speeds up the git directory scan:
   ```bash
   git -C /mnt/g/Projects/Development/smm-video status -uno
   ```
2. **Avoid Global Workdir Re-routing Errors:** If a path translation error occurs due to Windows backslashes in path configurations (e.g., `/usr/bin/bash: cd: \mnt\g\hermes`), use the `-C` flag with absolute paths directly from `/home/` to avoid shifting directory state:
   ```bash
   git -C /absolute/path/to/repo log -n 5 --oneline
   ```

---

## 3. Telegram Polling and API Connection Conflicts

### The Symptom
The log file reports a conflict error:
`Conflict: terminated by other getUpdates request; make sure that only one bot instance is running`

This indicates multiple active instances are polling Telegram with the exact same `TELEGRAM_BOT_TOKEN` simultaneously.

### Diagnostic Steps

#### Step A: Check WSL Processes & User Services
Check if any other local python or background process on WSL is running the gateway, or if a background systemd user service is holding the Telegram connection:
```bash
ss -atp | grep -E "149.154|telegram"
```
*(No other PIDs listed means WSL is clean.)*

Also check active systemd user-level services which might auto-restart a conflicting polling gateway (e.g., `openclaw-gateway.service` or old versions of Hermes):
```bash
# List all active user services
systemctl --user list-units --type=service

# Stop and disable the conflicting user service
systemctl --user stop openclaw-gateway.service
systemctl --user disable openclaw-gateway.service
```

#### Step B: Query the Windows Host Connections
Since the Windows host and WSL share the network but processes are isolated, query Windows active sockets directly from WSL using Windows binaries:

```bash
# Search Windows netstat for active Telegram connections (using Telegram's subnet 149.154.*)
netstat.exe -ano | grep -E "149.154"
```

If a connection is found, match the Windows PID (the last column in `netstat -ano`) to the executable name:

```bash
# Translate Windows PID to task name
tasklist.exe | grep -a "<WINDOWS_PID>"
```
*(e.g., If `Telegram.exe` is running on Windows, it might hold an active connection, but if another `node.exe` or `python.exe` is holding it, it could be a local background runner.)*

#### Step C: Remote Server Isolation
If both WSL and Windows processes are clean, the conflict is **external** (e.g., a production/staging instance running on Selektel, Replit, or a VPS is using the same credentials). In this case, temporarily stop the local gateway to let the remote instance run unimpeded.

---

## 4. Path Translation & Config Diagnostics

WSL and Windows paths can sometimes get confused in cross-environment configurations, especially when Windows path separators (`\`) propagate into WSL bash environments.

| Target Path | WSL Mount Equivalent |
|-------------|----------------------|
| `C:\Users\username\Projects` | `/mnt/c/Users/username/Projects` |
| `G:\Projects\Development` | `/mnt/g/Projects/Development` |

### Case Study: WSL Terminal Hook CD Failures
**Symptom:** Every terminal command fails with a shell initialization error like:
`/usr/bin/bash: line 2: cd: \mnt\g\hermes: No such file or directory` (with exit code 126 or similar).

**Root Cause:** In `~/.hermes/config.yaml`, the key `terminal.cwd` was written with Windows-style backslashes (e.g., `cwd: \mnt\g\hermes` or `cwd: G:\Projects`). When WSL bash initializes the interactive shell, it executes `cd "\mnt\g\hermes"`. Bash treats backslashes as escape characters or literal directory parts, failing to locate the path and causing shell command failures.

**The Fix:** 
Use the Hermes config utility to rewrite the `terminal.cwd` option to use native Linux forward-slashes (and run the command from an explicitly passed `/home/` working directory to bypass the active CD bug):
```bash
hermes config set terminal.cwd /home/signmark
```
Alternatively, set it to your active project workspace directory:
```bash
hermes config set terminal.cwd /mnt/g/Projects/Development/smm-video
```
After executing, restart the Hermes CLI session or trigger a gateway reload with `/restart` to make the settings take effect.

---

## 5. SQLite Database Corruption (e.g., TLS/Network Overwrites)

### The Symptom
The gateway or command-line utility fails during initialization with errors stating a database file is not a valid SQLite database:
`ERROR: kanban dispatcher: board default database /home/signmark/.hermes/kanban.db is not a valid SQLite database`

Checking the file contents or file header reveals binary network or protocol traffic (e.g., TLS Application Data headers `\x17\x03\x03` or HTTP response bytes) instead of the standard SQLite header format (`SQLite format 3\x00`).

### Root Cause
This occurs when a port conflict, misconfigured local socket proxy, or conflicting service (such as an old gateway/API daemon) mistakenly writes raw socket traffic or network protocol streams directly to the database file descriptor or filepath.

### Resolution Steps
1. **Identify and Stop Conflicting Services:** Refer to the steps in Section 3 to ensure no other background services (e.g., user-level systemd services) are active and miswriting to the directory.
2. **Backup the Corrupted Database:**
   ```bash
   mv ~/.hermes/kanban.db ~/.hermes/kanban.db.corrupted_tls
   ```
3. **Re-initialize a Fresh Database:**
   ```bash
   hermes kanban init
   ```
4. **Restart the Gateway:** Restart your gateway background process or TMUX session to load the fresh, uncorrupted database.


