#!/usr/bin/env python3
"""Replace the Orca Pro Max bundle while it runs (like an auto-update), then quit it so it reopens new."""
import os
import subprocess
import time
from datetime import datetime

LOG = os.path.expanduser("~/Library/Logs/orca-update-install.log")
BUNDLE_ID = "com.stablyai.orca.dev"
INSTALLED = "/Applications/Orca Pro Max.app"
NEW_BUILD = "/Users/juan/Desktop/Software/Sideprojects/orca/dist/mac-arm64/Orca Pro Max.app"
BACKUP = os.path.expanduser("~/Desktop/Orca Pro Max (anterior).app")
EXECUTABLE_ARG = INSTALLED + "/Contents/MacOS/Orca Pro Max"


def log(message: str) -> None:
    with open(LOG, "a") as handle:
        handle.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")


def main_app_pids() -> set[int]:
    out = subprocess.run(["ps", "-Ao", "pid=,command="], capture_output=True, text=True).stdout
    pids = set()
    for line in out.splitlines():
        pid, _, command = line.strip().partition(" ")
        # Why exact match: helpers, the daemon and CLI calls also run from the bundle.
        if command.strip() == EXECUTABLE_ARG:
            pids.add(int(pid))
    return pids


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main() -> None:
    log("swap-first: waiting 30s so the session can reply first")
    time.sleep(30)
    if not os.path.isdir(NEW_BUILD):
        log(f"ABORT: new build missing at {NEW_BUILD}")
        return
    old_pids = main_app_pids()
    log(f"running app pids: {sorted(old_pids)}")
    backup = BACKUP
    # Why one backup: each is ~600 MB; only the build just replaced is worth rolling back to.
    if os.path.exists(backup):
        log(f"removing previous backup {backup}")
        subprocess.run(["rm", "-rf", backup], check=True)
    log(f"moving old app to {backup}")
    subprocess.run(["mv", INSTALLED, backup], check=True)
    log("copying new build into /Applications")
    if subprocess.run(["ditto", NEW_BUILD, INSTALLED]).returncode != 0:
        log("copy failed; restoring the old app and stopping")
        subprocess.run(["rm", "-rf", INSTALLED])
        subprocess.run(["mv", backup, INSTALLED])
        return
    log("new build in place; quitting the running app")
    subprocess.run(["osascript", "-e", f'tell application id "{BUNDLE_ID}" to quit'])
    deadline = time.time() + 600
    while any(alive(pid) for pid in old_pids) and time.time() < deadline:
        time.sleep(0.5)
    if any(alive(pid) for pid in old_pids):
        log("old app still running after 10 min; new build is installed and loads on next launch")
        return
    time.sleep(3)
    if main_app_pids():
        log(f"app already relaunched (pids {sorted(main_app_pids())}) from the new bundle")
    else:
        log("opening Orca Pro Max")
        subprocess.run(["open", INSTALLED])
    log("done")


if __name__ == "__main__":
    main()
