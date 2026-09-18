import os

# Serverless environments (like AWS Lambda / Vercel) have a read-only filesystem except for /tmp.
# Ensure Matplotlib writes its font/config cache to /tmp when loaded in serverless functions:
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

# Import the Flask application instance directly from app.py without modifying app.py
from app import app

# Vercel discovers the exposed WSGI application callable named 'app'
# Local development using `python app.py` or `python wsgi.py` remains completely unaffected.
if __name__ == "__main__":
    app.run()
