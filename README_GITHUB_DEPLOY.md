# Opsloom GitHub and deployment guide

## What GitHub is for
Use GitHub to store and version the code. Use a private repository if you do not want the source files to be publicly readable.

## What to deploy
This is a Flask application. Deploy the repository to a Python host such as Render, Railway, Fly.io, or your own VPS. GitHub alone will not run the app for users.

## Safe structure
- Keep the GitHub repository private
- Add only the collaborators who should access the code
- Keep secrets in environment variables, not hard-coded in the repository
- Keep the public app behind the system login so only approved users can enter

## Recommended repo files already included
- requirements.txt
- Procfile
- .gitignore

## Local multi-device access
Run the app and open it from your phone using your computer's local IP, for example:
- http://192.168.x.x:5000

The app entrypoint is already set to bind to 0.0.0.0 by default when started with python app.py.

## Before pushing
1. Review data/datastore.json and keep only demo-safe data
2. Make sure instance database files are not committed if you want a clean demo
3. Set FLASK_SECRET_KEY on the deployment target
4. Set debug off in production
