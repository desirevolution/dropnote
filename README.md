# Dropnote

Dropnote is a self-hosted web app for sharing plain-text notes and files. A space has its own link, live editing and optional end-to-end encryption.

[GitHub repository](https://github.com/desirevolution/dropnote) · [Releases](https://github.com/desirevolution/dropnote/releases)

## Quick start with Docker Compose

Download [`compose.yaml`](compose.yaml) and run the following command from the directory where you saved it.

```sh
docker compose up -d
```

Open <http://localhost:8080>. Compose pulls `ghcr.io/desirevolution/dropnote:0.1.0` and stores data in a named volume. Copy [`.env.example`](.env.example) to `.env` for optional settings. `DROPNOTE_PORT` is the published host port and `PORT` is the port inside the container. They default to 8080 and 3000 respectively.

To upgrade, set `DROPNOTE_VERSION` in `.env` to the desired release tag without the leading `v`, then run `docker compose pull` and `docker compose up -d`. Keep the same Compose project and volume. See [Data volume and backups](#data-volume-and-backups) for a backup and restore example.

For a standalone container, use the same release image.

```sh
docker run -d --name dropnote -p 8080:3000 -v dropnote-data:/app/data ghcr.io/desirevolution/dropnote:0.1.0
```

### Build locally with Compose

Run this from the repository root to build and run the development variant.

```sh
docker compose -f compose.dev.yaml up -d --build
```

Both Compose files use the same service and volume names. To run the dev variant alongside a production instance, select a separate Compose project with `-p dropnote-dev` and set a different `DROPNOTE_PORT`.

Requires Node.js 24 or newer. Install development dependencies to build the browser bundle from source.

```sh
npm ci
npm start
```

Open <http://localhost:3000>. `npm start` builds the browser bundle before starting the server. To load a local `.env` file explicitly, run `npm run build && node --env-file=.env src/main.ts`.

### Upgrading from a build with the previous project name

The Compose service is now `dropnote`, the default named volume is `dropnote-data` and the host port setting is `DROPNOTE_PORT`. Update your reverse proxy upstream and the port setting in `.env` if you customized them. Compose creates a new volume by default. To keep existing unencrypted spaces, restore a backup into the new volume or mount the existing volume at `/app/data`.

Browser bookmarks, start-page choices and remembered keys from the previous build need to be set up again. The new build uses new encryption context labels, so encrypted spaces created with the previous build require that build for access. Copy their content and files before upgrading if you want to recreate them in the new build.

## Using spaces

| Task | In the app |
| --- | --- |
| Open the shared workspace | **Open shared space** goes to `/default`. The site root opens this space by default. |
| Choose what opens at the site root | Use **⋯ → Set as start page** on any space. The choice is saved in this browser. |
| Create a space | **New space** offers encryption and expiry. **More options** has the optional name and editing PIN. A generated address looks like `/p/amber-otter`. |
| Return to a space | **Saved spaces** shows bookmarks. In single-user mode it also lists spaces created in this browser until they are deleted or expire. In multiuser mode, **My spaces** lists the spaces you own across devices. |
| Share a link | Use **Copy link** or **QR code**. In multiuser mode, first use **⋯ → Manage access** to grant the recipient access. Give recipients the passphrase separately for encrypted spaces. |
| Edit or copy the note | Use the live plain-text editor and **Copy text**. **Full width** moves the file list below the editor until you toggle it back. |
| Share a screenshot or file | Add files, drag and drop, or paste an image. Open an image preview and choose **Copy image** to copy the full-resolution image as PNG. Clipboard access depends on browser support and permission. |
| Clear the shared workspace | **⋯ → Clear note** and **⋯ → Remove all files** are separate confirmed actions. |
| Manage an additional space | **⋯ → Change expiry** and **⋯ → Delete space** require write access. In multiuser mode these actions are available to the owner. The default expiry is seven days unless configured otherwise. |

The note saves automatically and shows other active cursors. **Changes pending** means the server has yet to acknowledge one or more changes. **Synced** means all local updates have been acknowledged. If the connection drops, loaded content stays visible and editing resumes after reconnection.

### Encrypted spaces

Enter a passphrase of at least 12 characters during creation. The completion dialog lets you copy the link and passphrase separately. The link is the Pad's address. The browser derives the Key locally from the passphrase and verifies it before connecting. Opening or reloading asks for the passphrase by default. **Keep unlocked in this browser** saves the derived Key for that Pad. **Lock space** forgets it and locks open tabs in the same browser profile.

The passphrase is fixed for the lifetime of a Pad. Save it somewhere safe, as the instance cannot reset or recover it. This version uses the passphrase format for all Encrypted Pads. Older Pads created with a Key in the link cannot be opened in this version. There is no automatic migration of their stored data.

## PIN — edit gating and management

An optional **editing PIN** (4–10 digits) unlocks writes for someone who already has permission to edit. It gates edits to the Note, uploads, file removal, Pad deletion and expiry changes. In multiuser mode, deletion and expiry changes also require ownership. Shared space is permanent.

The PIN form exchanges the PIN for a short-lived token via `POST /api/pads/<Slug>/pin`. The token rides on the sync connection as `?token=…` and on HTTP requests as `Authorization: Bearer …`. After ten minutes the UI returns to read-only. Encrypted requests also use the browser's separate Pad proof. The server never receives the passphrase or encryption Key.

PIN comparison is constant-time (scrypt digests, `crypto.timingSafeEqual`), and only scrypt material is stored — never the PIN itself. Five failed attempts trigger a lockout for `PIN_LOCKOUT_SECONDS` (default 15 minutes). The lockout is scoped to the Pad and direct connection IP, and in multiuser mode to the account as well.

## Attachments

The flat list preserves multiple files with the same name. Each file shows its own progress and can be retried individually. The attachment metadata, including the filename and any thumbnail, lives in the synced Yjs document. Encrypted Pads protect this metadata along with the file bytes.

| Method   | Path                                     | Behavior                                                              |
| -------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `POST`   | `/api/pads/<Slug>/attachments`           | Upload: streamed chunk-by-chunk to disk, answers `{ blobId, size }`.   |
| `GET`    | `/api/pads/<Slug>/attachments/<blobId>`  | Download: plain bytes or an encrypted container. Plain downloads may set `?name=`.   |
| `DELETE` | `/api/pads/<Slug>/attachments/<blobId>`  | Deletion: removes the blob; the client removes the list entry from the Yjs document. |

Uploads are rejected with a clear `413` error above the per-file limit (`MAX_FILE_SIZE`, default 1 GB) or when they would exceed the global instance limit (`MAX_INSTANCE_SIZE`, default 10 GB). The server streams uploads to disk. For encrypted spaces, both limits count the encrypted upload bytes, including encryption overhead.

## Configuration

The server reads these settings from its process environment.

| Variable             | Default                 | Meaning                                                                 |
| -------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `PORT`               | `3000`                  | HTTP port the server listens on (`0` picks a free port).                |
| `BASE_URL`           | `http://localhost:PORT` | Public URL. In multiuser mode its origin must match the address used by browsers. The UI builds links and QR codes from the current browser origin. |
| `DATA_DIR`           | `./data`                | Directory holding all persistent state (JSON index, per-Pad data).      |
| `MULTIUSER`          | `false`                | Require proxy authentication and enable private spaces and account grants. |
| `TRUSTED_PROXIES`    | *(unset)*              | Comma-separated direct proxy IPs or CIDRs. Required when `MULTIUSER=true`. |
| `INSTANCE_PIN`       | *(unset = off)*         | Instance PIN gating Pad creation; reading and editing never require it. |
| `DEFAULT_TTL`        | `7d`                    | Default TTL offered at Pad creation (`s`/`m`/`h`/`d`, or `never`).      |
| `MAX_TTL`            | `never` (unbounded)     | Longest TTL a Pad may be given (`s`/`m`/`h`/`d`, or `never`); must not be shorter than `DEFAULT_TTL`. |
| `MAX_FILE_SIZE`      | `1GB`                   | Per-file size limit (plain bytes or `KB`/`MB`/`GB`, 1024-based).        |
| `MAX_INSTANCE_SIZE`  | `10GB`                  | Total stored attachment bytes across the instance.      |
| `PAD_PATH`           | `/p`                    | URL path prefix under which additional Pads are addressed.              |
| `PIN_LOCKOUT_SECONDS` | `15m`                  | Lockout after 5 failed PIN attempts. Scoped to direct IP, Pad and, in multiuser mode, account.              |
| `CLEANUP_SWEEP_SECONDS` | `60s`                | How often the cleanup sweep deletes expired Pads (with all their files). |
| `RATE_LIMIT_WINDOW`  | `1m`                    | Rate-limit window (rate limiting is always on).                         |
| `RATE_LIMIT_MAX`     | `120`                   | Maximum requests per rate-limit window.                                 |

Invalid settings are reported at startup. See [`.env.example`](.env.example) for the configuration template. The image defaults to `PORT=3000` and `DATA_DIR=/app/data`. With Compose, add settings to `.env`. With `docker run`, use `--env-file .env` or individual `-e` arguments.

**Instance PIN:** when `INSTANCE_PIN` is set, creating a Pad requires it (the creation form asks for it; the creation request carries it as `instancePin`); reading and editing existing Pads never require it. Unset (default), creation is open. The request's `pin` field is the optional per-Pad PIN (above) — a different credential.

## Security model

**Single-user access.** Anyone who can reach the instance and knows a space's address can open its page. The editing PIN controls writes. An encrypted space requires its passphrase to open its content.

**Multiuser access.** Dropnote accepts the username from the trusted proxy and checks space permissions on the server for pages, API calls, file transfers and Live-Sync. A link or QR code supplies the address. The owner grants permissions to the exact login name. A denied account receives the same 404 as it would for a missing space.

**Encrypted spaces.** The browser derives a 256-bit Key with PBKDF2-HMAC-SHA-256, 600,000 iterations and a per-Pad salt. AES-GCM protects the Note, attachment metadata, file contents and transient cursor positions. In multiuser mode, account names and permissions are visible to the server, and active cursor labels identify the editors to other participants. The server retains ciphertext, Pad metadata and the digest of a separate access proof. A strong, unique passphrase matters because a copy of the stored data permits offline guessing. HTTPS or localhost is required by the browser for Web Crypto.

**Editing PIN and lockout.** The PIN gates relay writes, Attachment uploads/removals and management on that Pad; comparison is constant-time and only scrypt material is stored. A multiuser PIN token is bound to the account that unlocked editing.

**Instance PIN.** `INSTANCE_PIN` gates only Pad creation, keeping strangers from filling a public instance's disk; it never restricts reading or editing existing Pads.

**Rate limiting is always on** and has no off switch — it protects Slug guessing, creation and upload bursts. Its client IP is the socket address; see [Reverse proxy](#reverse-proxy) for what that means behind a proxy.

The trust model assumes the browser receives the intended application code. Keep the server and its delivery path under your control.

## Data volume and backups

The container runs as UID 1000 and stores the space index, sync logs and attachments under `DATA_DIR` (`/app/data` by default). A fresh named volume is initialized with the correct ownership. If you bind-mount a host directory, make it writable by UID 1000 before starting the container.

Stop Dropnote before taking a backup so the index and the files are copied consistently. This example uses the standalone container and volume from the quick start. For Compose, stop the service with `docker compose stop` and substitute the actual volume name, typically prefixed with the Compose project name.

```sh
docker stop dropnote
mkdir -p backup
docker run --rm \
  -v dropnote-data:/data:ro \
  -v "$PWD/backup:/backup" \
  alpine tar -czf /backup/dropnote-data.tar.gz -C /data .
docker start dropnote
```

To restore, extract into a fresh volume and mount that volume at `/app/data` when starting Dropnote.

```sh
docker volume create dropnote-restored
docker run --rm \
  -v dropnote-restored:/data \
  -v "$PWD/backup:/backup:ro" \
  alpine sh -c 'tar -xzf /backup/dropnote-data.tar.gz -C /data && chown -R 1000:1000 /data'
```

Keep encrypted spaces' passphrases separately. The volume contains the data needed to restore the space. See [Docker's volume backup and restore guide](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes).

## Reverse proxy

Dropnote serves HTTP and Live-Sync WebSockets under `/sync/<slug>`. Terminate TLS at your reverse proxy. If you use Authelia, apply its access policy to the entire site, including the API and WebSocket path. With multiuser mode enabled, Dropnote applies account permissions inside the app.

With Caddy and Dropnote on the same Docker network, the Compose service name is `dropnote`. Caddy handles WebSocket upgrades through its standard [reverse proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

```caddyfile
dropnote.example.com {
    reverse_proxy dropnote:3000
}
```

- Rate limits use the direct connection IP, so clients behind the same proxy share a request budget. PIN lockouts additionally use the account in multiuser mode.
- PIN unlock tokens can appear as `?token=…` in the WebSocket URL. Omit that query parameter or the whole query from proxy access logs.

### Multiuser with Caddy and Authelia

Enable the mode in `.env`. Use the public HTTPS address for `BASE_URL` and the direct IP of your Caddy instance for `TRUSTED_PROXIES`. Replace the example IP with your own. For Docker, attach Caddy and Dropnote to a private network, assign Caddy a stable address and remove the Dropnote service's published `ports` mapping. Use a fresh data volume for this mode. Dropnote refuses to open a volume initialized in the other mode.

```dotenv
MULTIUSER=true
TRUSTED_PROXIES=172.30.50.2
BASE_URL=https://dropnote.example.com
```

Caddy removes the incoming identity header before it asks Authelia to authenticate the request. It copies Authelia's verified username to Dropnote on both HTTP requests and WebSocket handshakes. Apply your Authelia access policy to the whole Dropnote host. Authelia authenticates each new WebSocket handshake. An open connection keeps that identity until it closes.

```caddyfile
dropnote.example.com {
    route {
        request_header -X-Forwarded-User
        forward_auth authelia:9091 {
            uri /api/authz/forward-auth
            copy_headers Remote-User>X-Forwarded-User
        }
        reverse_proxy dropnote:3000
    }
}
```

Dropnote uses case-sensitive login names up to 128 characters with letters `A–Z` and `a–z`, digits and `_.@+-`. Missing, duplicate and malformed identity headers are rejected. The app uses the direct socket IP to identify the proxy.

| Access | What the account can do |
| --- | --- |
| Owner | Open, edit, grant or revoke access, change expiry and delete the space. |
| Can read | Read the note and download files. |
| Can edit | Read and edit the note, upload files and remove files. |
| Authenticated account at `/default` | Open and edit the permanent shared space. |

New spaces start private. Use **⋯ → Manage access** to grant or remove permission. Removing a grant disconnects that user's open editor and prevents new requests. A downloaded file or previously copied text stays with its recipient. Encrypted spaces still require their passphrase. If the space has an editing PIN, editors and owners still need it to write. Bookmarks, the browser's start page and remembered encryption keys are scoped to the active login.

### Nginx transport example

```nginx
# http { } level — log $uri instead of $request_uri: keeps ?token= out of logs
log_format dropnote '$remote_addr - $time_local "$request_method $uri" $status';

# server { } level
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSocket (Live-Sync)
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;                        # keep sync connections open
    access_log /var/log/nginx/dropnote.log dropnote;
}
```

## Development

```sh
npm run typecheck   # tsc --noEmit
npm run build       # bundle the editor frontend into public/js/editor.bundle.js
npm test            # build the frontend and run the black-box tests
```

The test harness starts the real server as a child process (fresh `DATA_DIR`, ephemeral `PORT`) and drives it over HTTP and WebSocket — the server API is the test seam. Live-Sync is verified with headless Yjs clients (`yjs` over `ws`) driving the real server: edits propagate live, concurrent edits merge without losing keystrokes, and the Note persists across a restart.

`test/deployment.test.ts` is the deployment smoke test: it builds the Docker image, boots a container with a temporary data volume, runs the API smoke facts against it (root serves the Default Pad page, JSON 404 shape), verifies the non-root UID and the data-dir ownership contract, asserts that a wrongly-owned directory fails boot with the permission error, and that data in the volume survives container replacement. It skips cleanly when Docker is unavailable; the first run builds the image (minutes), later runs reuse the layer cache.

The editor uses CodeMirror and Yjs, bundled with esbuild. The generated bundle is excluded from Git. Run `npm run build` to refresh it while the server is running. The Docker image builds and includes its own bundle.

See the [glossary](GLOSSARY.md), the [encryption design](docs/adr/0001-client-side-e2e-zero-knowledge.md) and the [Live-Sync design](docs/adr/0002-yjs-live-sync-encrypted-relay.md).
