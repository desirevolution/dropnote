# Real browser regression checks

Use Node 26 (the Dockerfile version), Python 3 and a Docker daemon for the full release gate.

```sh
npm ci
npm run typecheck
npm test                    # includes actual Docker build/deployment smoke tests
python3 -m venv .venv-e2e
.venv-e2e/bin/pip install -r test/e2e/requirements.txt
.venv-e2e/bin/python -m playwright install chromium
.venv-e2e/bin/python test/e2e/editor.py
```

On Linux install Chromium system libraries via `python -m playwright install --with-deps chromium` if necessary. `CHROMIUM_PATH=/usr/bin/chromium` optionally uses a preinstalled Chromium. The script starts a real server with a fresh temporary data directory, drives the production bundles with two tabs, and fails on assertions or browser page errors. It never uses a live production data directory. The plain guest browser flow uses a separate guest HTTPS origin bridged to the real local HTTP server (no TLS certificate or DNS required). The real router still checks Host and Origin; unexpected private requests fail the test. Encrypted guest authentication, proof, expiry and revoke cases are covered by the existing Node HTTP integration suite. Browser tests do not replace those security checks.
