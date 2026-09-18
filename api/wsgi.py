import os
import sys
import errno

# 1. Ensure the parent directory root is in sys.path for resolving app.py and project modules
parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# 2. Serverless environments have a read-only filesystem (/var/task). Only /tmp is writable.
# Ensure Matplotlib writes its font and configuration cache to /tmp:
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

# 3. Intercept os.makedirs before app.py is imported to prevent Errno 30 (EROFS)
# On Vercel / AWS Lambda, the application source tree is mounted as a read-only filesystem.
# Any top-level directory creation targeting /var/task/... raises OSError: [Errno 30] Read-only file system.
_orig_makedirs = os.makedirs

def _safe_makedirs(name, mode=0o777, exist_ok=False):
    try:
        _orig_makedirs(name, mode=mode, exist_ok=exist_ok)
    except OSError as e:
        # Ignore read-only filesystem errors (Errno 30 EROFS) and permission errors on read-only mounts
        if getattr(e, "errno", None) in (errno.EROFS, 30, errno.EACCES):
            pass
        else:
            raise

os.makedirs = _safe_makedirs

# 4. Cleanly import the Flask instance from app.py without modifying any business logic in app.py
from app import app

# Maintain standard local execution entry point
if __name__ == "__main__":
    app.run()
