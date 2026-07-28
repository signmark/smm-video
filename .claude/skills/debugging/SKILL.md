---
name: debugging
description: "Multi-language debugging: Python pdb/debugpy, Node.js inspect/CDP, and systematic 4-phase root-cause methodology."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [debugging, python, nodejs, pdb, debugpy, inspect, cdp, root-cause, troubleshooting]
---

# Debugging — Multi-Language + Systematic Methodology

Three capabilities in one skill:
- **Section A:** Systematic 4-phase root-cause debugging (language-agnostic)
- **Section B:** Python debugging (pdb REPL + debugpy remote DAP)
- **Section C:** Node.js debugging (node inspect + CDP/Chrome DevTools Protocol)

---

## Section A: Systematic Debugging — 4-Phase Method

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

### Phase 1: Root Cause Investigation
1. Read error messages carefully — line numbers, file paths, error codes
2. Reproduce consistently — exact steps, every time
3. Check recent changes — git diff, recent commits, config changes
4. Gather evidence in multi-component systems — log data at each component boundary
5. Trace data flow upstream until source

### Phase 2: Pattern Analysis
1. Find working examples in the codebase
2. Compare working vs broken — every difference matters
3. Identify all dependencies, assumptions, config

### Phase 3: Hypothesis and Testing
1. Form single hypothesis: "I think X is root cause because Y"
2. Test with SMALLEST possible change, one variable at a time
3. Didn't work → new hypothesis, don't add more fixes on top
4. Don't know → say so, don't pretend

### Phase 4: Implementation
1. Create failing test case FIRST (use `test-driven-development`)
2. Implement single fix addressing root cause
3. Verify: specific test passes + full suite passes
4. **Rule of 3:** If 3+ fixes failed → STOP, question architecture, discuss with user

### Red Flags — STOP
- "Quick fix for now, investigate later"
- "Just try changing X and see"
- Multiple fixes at once
- Proposing solutions before tracing data flow
- Each fix reveals a new problem in a different place

---

## Section B: Python Debugger (pdb + debugpy)

### Tool Selection
| Tool | When |
|------|------|
| `breakpoint()` + pdb | Local, interactive, simplest — start here |
| `python -m pdb` | Launch script under pdb, no source edits |
| `debugpy` | Remote/headless/attach to running process |

### pdb Quick Reference
| Command | Action |
|---------|--------|
| `n` | next line (step over) |
| `s` | step into |
| `r` | return from current function |
| `c` | continue |
| `w` | where (stack trace) |
| `u` / `d` | move up/down in stack |
| `p expr` / `pp expr` | print / pretty-print |
| `display expr` | auto-print on every stop |
| `b file:line` | set breakpoint |
| `!stmt` | execute arbitrary Python |
| `interact` | drop into full REPL in current scope |

### Recipes

**Local breakpoint:**
```python
def compute(x, y):
    result = some_helper(x)
    breakpoint()
    return result + y
```

**Debug pytest test:**
```bash
pytest tests/test_module.py::test_name --pdb -p no:xdist
```

**Post-mortem:**
```python
import pdb, sys
try: run_the_thing()
except Exception: pdb.post_mortem(sys.exc_info()[2])
```

**Remote debug (debugpy):**
```python
import debugpy
debugpy.listen(("127.0.0.1", 5678))
debugpy.wait_for_client()
debugpy.breakpoint()
```

**Remote-pdb (cleanest for terminal agents):**
```python
from remote_pdb import set_trace
set_trace(host="127.0.0.1", port=4444)
# Then: nc 127.0.0.1 4444
```

### Debugging Hermes Processes
- **Tests:** `pytest --pdb -p no:xdist` (xdist blocks pdb)
- **CLI/CLI:** Add `breakpoint()` near suspect line
- **TUI gateway:** `remote-pdb` at RPC handler + `nc` in another terminal
- **Gateway:** `remote-pdb` or `debugpy --wait-for-client`

### Pitfalls
1. pdb under pytest-xdist silently does nothing — always use `-p no:xdist`
2. `breakpoint()` in CI/non-TTY hangs — never commit it
3. `PYTHONBREAKPOINT=0` disables all breakpoints
4. debugpy attach fails on hardened kernels — `ptrace_scope=1` → need root or start under debugpy
5. pdb only debugs current thread — use debugpy for multithreaded
6. Forking/multiprocessing: pdb doesn't follow forks

---

## Section C: Node.js Inspect Debugger

### Tool Selection
| Tool | When |
|------|------|
| `node inspect` | Built-in CLI REPL, zero install |
| CDP via `chrome-remote-interface` | Scriptable, automate many breakpoints |

### Quick Reference: `node inspect` REPL
```bash
node inspect path/to/script.js
node --inspect-brk $(which tsx) path/to/script.ts
```

| Command | Action |
|---------|--------|
| `c` / `cont` | continue |
| `n` / `next` | step over |
| `s` / `step` | step into |
| `o` / `out` | step out |
| `sb('file.js', 42)` | set breakpoint |
| `cb('file.js', 42)` | clear breakpoint |
| `bt` | backtrace |
| `list(5)` | show source around current position |
| `watch('expr')` | watch expression |
| `repl` | drop into JS REPL in current scope |
| `exec expr` | evaluate expression once |

### Attaching to Running Process
```bash
kill -SIGUSR1 <pid>  # enable inspector
node inspect -p <pid>
```

### Programmatic CDP
```javascript
const CDP = require('chrome-remote-interface');
const client = await CDP({ port: 9229 });
const { Debugger, Runtime } = client;
Debugger.paused(async ({ callFrames }) => { /* inspect scopes */ });
await Debugger.setBreakpointByUrl({ urlRegex: '.*app\\.tsx$', lineNumber: 119 });
await Runtime.runIfWaitingForDebugger();
```

### Debugging Hermes ui-tui
```bash
hermes --tui &
TUI_PID=$(pgrep -f 'ui-tui/dist/entry' | head -1)
kill -SIGUSR1 "$TUI_PID"
node inspect -p $TUI_PID
```

### Pitfalls
1. Wrong line numbers in TS — breakpoints hit emitted JS, not `.ts`. Use `--enable-source-maps` or break in `dist/*.js`.
2. `--inspect` vs `--inspect-brk`: use `-brk` when setting breakpoints before code runs.
3. `--inspect` on parent doesn't inspect children — use `NODE_OPTIONS='--inspect-brk'`
4. `node inspect` through agent terminal needs `pty=true`
5. `--inspect=0.0.0.0:9229` exposes arbitrary code execution — always bind 127.0.0.1
