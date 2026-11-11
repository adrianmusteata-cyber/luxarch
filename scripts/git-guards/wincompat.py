"""Windows (Git Bash) compatibility helpers for the guard's Python parts.
Everywhere else each function is the plain POSIX behaviour.

Under Git Bash the scripts run in MSYS bash, but python3 is the native Windows
interpreter. Paths reach Python in MSYS form (`/c/Users/x`, `/tmp/x`) through
JSON on stdin, environment variables and heredocs — places where MSYS does not
convert them. Native Python reads `/c/Users/x` as `<current drive>:\\c\\Users\\x`,
so every comparison with what git prints (`C:/Users/x`) failed.

native(p)      — an MSYS path → `C:/…`; anything else is returned unchanged.
expanduser(p)  — `~` honours $HOME on Windows too (Git Bash sets it; tests override it).
pid_alive(pid) — 🔴 os.kill(pid, 0) on Windows does not probe, it TERMINATES the
                 process. A pid may also be an MSYS one (`$$` written by bash).
kill_tree(pid) — the process and its children (no process groups on Windows).
is_exec(f)     — runnable: Windows has no exec bit.
"""

import os
import re
import subprocess

WIN = os.name == "nt"
_DRIVE = re.compile(r"^/([A-Za-z])(?=/|$)")
_cache: dict[str, str] = {}


def native(p):
    if not WIN or not isinstance(p, str) or not p.startswith("/") or p.startswith("//"):
        return p
    m = _DRIVE.match(p)
    if m:
        return m.group(1).upper() + ":" + (p[2:] or "/")
    if p not in _cache:              # /tmp, /usr… — only cygpath knows the mount table
        try:
            out = subprocess.run(("cygpath", "-m", p), capture_output=True,
                                 text=True, timeout=5).stdout.strip()
        except Exception:
            out = ""
        _cache[p] = out or p
    return _cache[p]


def expanduser(p):
    if WIN and isinstance(p, str) and (p == "~" or p.startswith(("~/", "~\\"))):
        home = os.environ.get("HOME")
        if home:
            return native(home) + p[1:]
    return os.path.expanduser(native(p))


def is_exec(f):
    """Windows has no exec bit (os.access X_OK is always true): runnable means a
    PATHEXT extension (.exe, .cmd…) or a `#!` script, which Git Bash runs."""
    if not os.path.isfile(f):
        return False
    if not WIN:
        return os.access(f, os.X_OK)
    exts = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").lower().split(";")
    if os.path.splitext(f)[1].lower() in exts:
        return True
    try:
        with open(f, "rb") as fh:
            return fh.read(2) == b"#!"
    except OSError:
        return False


def _win_pid_alive(pid):
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    h = k32.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ctypes.get_last_error() == 5           # ERROR_ACCESS_DENIED: exists
    try:
        code = ctypes.c_ulong()
        return bool(k32.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
    finally:
        k32.CloseHandle(h)


def pid_alive(pid):
    if WIN:
        if _win_pid_alive(pid):
            return True
        try:                         # an MSYS pid: only the MSYS runtime knows it
            return subprocess.run(("kill", "-0", str(pid)), capture_output=True,
                                  timeout=5).returncode == 0
        except Exception:
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def shell_group(env):
    """→ (prefix for an `sh -c` script, file). Windows: the MSYS children of `sh` are
    not in the Windows process tree (taskkill /T misses a backgrounded `sleep`), so
    the shell writes its MSYS process group to the file for kill_tree."""
    if not WIN:
        return "", None
    import tempfile
    fd, path = tempfile.mkstemp(prefix="gg-pgid-")
    os.close(fd)
    env["GG_PGID_FILE"] = path
    return 'echo $$ > "$GG_PGID_FILE"; ', path


def kill_tree(pid, sig, group_file=None):
    if hasattr(os, "killpg"):
        os.killpg(pid, sig)
        return
    try:
        with open(group_file) as fh:
            pgid = fh.read().strip()
    except (OSError, TypeError):
        pgid = ""
    if pgid.isdigit():               # a shell started by native Python leads its own group
        subprocess.run(("kill", "-KILL", "--", "-" + pgid), capture_output=True, timeout=10)
    subprocess.run(("taskkill", "/T", "/F", "/PID", str(pid)), capture_output=True, timeout=10)
