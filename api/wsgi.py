import os
import sys

# Ensure parent directory root is in sys.path for resolving app.py and project modules
parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Serverless environments have a read-only filesystem except for /tmp.
# Ensure Matplotlib writes its font and configuration cache to /tmp:
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

# Cleanly import the Flask instance from app.py
from app import app

# Maintain standard execution entry point
if __name__ == "__main__":
    app.run()
