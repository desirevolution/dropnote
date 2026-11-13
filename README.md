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

## GitHub releases

Push the project to [desirevolution/dropnote](https://github.com/desirevolution/dropnote), including [the release workflow](.github/workflows/release.yml) and [Dependabot configuration](.github/dependabot.yml), before publishing the first release.

1. Open [Releases](https://github.com/desirevolution/dropnote/releases) and choose **Draft a new release**.
2. Create a tag such as `v0.1.0` or `v0.2.0-rc.1` and select the branch or commit to release.
3. Select **Publish release**. The **Publish Docker image** workflow builds the tagged revision for `linux/amd64` and `linux/arm64` and pushes a versioned image using GitHub's built-in token. Follow the job under **Actions**.

Release `v0.1.0` publishes `ghcr.io/desirevolution/dropnote:0.1.0`. If GitHub reports it as the latest stable release, the workflow also points `:latest` at the same multi-platform image. Prereleases and older releases publish only their version tag. To follow the stable release automatically with Compose, set `DROPNOTE_VERSION=latest` in `.env` and pull before restarting.

The header shows the release tag built into the running image. Local builds show `dev`.

GHCR package visibility is managed under **Packages**. Public images can be pulled anonymously. For a private image, sign in to `ghcr.io` on the deployment machine with a classic personal access token that has `read:packages` and access to the package. See [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

Dependabot checks npm dependencies, the Docker base image and workflow actions weekly.

## Running from source

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
| Open Default | **My spaces** lists **Default** first and opens it directly at `/default`. |
| Choose your start page | **Home** opens your browser's start page. Use **⋯ → Set as start page** to change it. **Reset start page** switches back to **Default**. A house marks the current start page. |
| Create a space | **New space** offers an optional display name and encryption. Under **More options**, you can set a custom URL address, expiry and editing PIN. Dropnote generates an address if you leave it empty and uses the name from that address when no display name is set. |
| Find a space | **My spaces** lists all active spaces in single-user mode and the spaces you own in multiuser mode. In multiuser mode, use **⋯ → Bookmark space** on a space shared with you to add it to **Bookmarks** on this browser. |
| Share a space | Use **Copy link** or **⋯ → QR code**. Copy the QR image where the browser supports it or download it as a PNG. In multiuser mode, grant access via **Manage access** or let the recipient request it. |
| Edit or copy the note | The **Note** tab offers **Paste text**, **Copy text**, and undo and redo. **View options** holds **Font size**, **Word wrap**, and **Line numbers**. Spaces containing only files open the **Files** tab. |
| Rename a space | **⋯ → Rename space** changes the display name in the space, **My spaces** and bookmarks. Links and QR codes still use the original address. This action requires the same permissions and unlocks as other space management actions. |
| Download the note | **⋯ → Download text (.txt)** saves a local UTF-8 text file named after the space address and the Unix timestamp in milliseconds, for example `project-notes-1794552905123.txt`. The downloaded file is plaintext, including when the note is encrypted in Dropnote. |
| Share a screenshot or file | Use **Add files** in the Note tab, click or drop files on **Choose files** in the Files tab, or paste an image into the editor or anywhere in the Files tab. Transfers and retries are visible in both tabs. The file list shows the newest uploads first. Use **Copy files link** to open the Files tab directly. Open an image preview and choose **Copy image** to copy the full-resolution image as PNG. Clipboard access depends on browser support and permission. |
| Clear Default | **⋯ → Clear note** and **⋯ → Remove all files** are separate confirmed actions. |
| Manage an additional space | **⋯ → Change expiry** and **⋯ → Delete space** require write access. In multiuser mode these actions are available to the owner. The default expiry is seven days unless configured otherwise. |

The **Paste text** button appends the clipboard text, starting on a new line when needed. If the browser blocks clipboard access, the editor is focused at the end so you can use your device’s Paste action.

With the **Note** tab selected, paste plain text outside the editor to fill an empty note or confirm replacing an existing note. Press Escape to cancel. A replacement is one undo step. With the cursor inside the editor, paste inserts text at the cursor or replaces the current selection.

The note saves automatically and shows other active cursors. The editor shows **Connected** while live sync is available. If the connection drops or a write goes unacknowledged for 10 seconds, Dropnote reconnects and retries unconfirmed changes. Loaded content stays visible, and **Changes pending** appears while editing is blocked and changes are still queued.

### Encrypted spaces

Use a passphrase of at least 12 characters or let Dropnote suggest a password of 17 random lowercase letters and digits or a passphrase of six random words. The suggested password omits easily confused characters and is shown in groups for typing. You can unlock the space with or without the displayed spaces. The interface, suggested words and generated space names follow the browser's German or English preference, with English as the fallback.

The browser derives the encryption key locally. The new space opens unlocked after creation. During that visit, **⋯ → QR code** offers **Copy passphrase** and **Include passphrase**. The second option embeds the passphrase in the copied link and QR code. The browser consumes it from the URL fragment to unlock the space. Anyone who obtains the full link or QR code has the passphrase. Multiuser access rules still apply. The top-level **Copy link** action always copies the address alone.

**Keep unlocked in this browser** saves the derived key for future visits. **Lock space** forgets the key and locks open tabs in the same browser profile. After leaving, reloading or locking the page, the original passphrase is only available from wherever you saved it.

The passphrase is fixed for the lifetime of a Pad. Save it somewhere safe, as the instance cannot reset or recover it. This version uses the passphrase format for all Encrypted Pads. Older Pads created with a Key in the link cannot be opened in this version. There is no automatic migration of their stored data.

## PIN — edit gating and management

An optional **editing PIN** (4–10 digits) unlocks writes for someone who already has permission to edit. It gates edits to the Note, uploads, file removal, renaming and expiry changes. To delete a space and all its files, use **My spaces → Delete space** and confirm. Deletion requires ownership in multiuser mode and access to the instance in single-user mode. It works while the space is locked, including spaces protected by a PIN. **Default** is permanent.

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

**Single-user access.** Anyone who can reach a single-user instance can list and delete its spaces. The editing PIN controls writes. An encrypted space requires its passphrase to open its content.

**Multiuser access.** Dropnote accepts the username from the trusted proxy and checks space permissions on the server for pages, API calls, file transfers and Live-Sync. A link or QR code supplies the address. The owner grants permissions to the exact login name. A denied account receives the same 404 as it would for a missing space.

**Encrypted spaces.** The browser derives a 256-bit Key with PBKDF2-HMAC-SHA-256, 600,000 iterations and a per-Pad salt. AES-GCM protects the Note, attachment metadata, file contents and transient cursor positions. In multiuser mode, account names and permissions are visible to the server, and active cursor labels identify the editors to other participants. The server retains ciphertext, Pad metadata and the digest of a separate access proof. A strong, unique passphrase matters because a copy of the stored data permits offline guessing. HTTPS or localhost is required by the browser for Web Crypto.

**Editing PIN and lockout.** The PIN gates relay writes, Attachment uploads/removals, renaming and expiry changes on that Pad; comparison is constant-time and only scrypt material is stored. A multiuser PIN token is bound to the account that unlocked editing.

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
| Authenticated account at `/default` | Open and edit the account’s own permanent Default space. |

Each account has its own Default note and files. The address `/default` opens the signed-in account’s space. If upgrading from a version with a shared Default, its data stays in the data directory. Personal Defaults start empty.

New spaces start private. A signed-in recipient without permission can choose **Request access** when opening a link. The response is the same for missing and private spaces. Dropnote keeps one open request per user and space. The badge on **My spaces** shows the total number of open requests and refreshes every 30 seconds while the page is visible. The owner sees counts per space in **My spaces** and can allow reading, allow editing or decline in **Manage access**. After sending a request, keep the confirmation page open to enter the space automatically once access is granted. The page checks every ten seconds while visible. The same link also works after approval. Owners can also grant or remove permissions directly. Removing a grant disconnects that user's open editor and prevents new requests. A downloaded file or previously copied text stays with its recipient. Encrypted spaces still require their passphrase. If the space has an editing PIN, editors and owners still need it to write. Bookmarks, the browser's start page and remembered encryption keys are scoped to the active login.

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

Use **Read only** next to the connection status to prevent accidental edits and file changes on this browser. Dropnote remembers the setting per space and account. Live sync, copying and downloads remain available. Turn off **Read only** from either tab to restore editing when your permissions allow it. Spaces shared with read permission show **Read-only access**.

The editor wraps text by default. Turn off **Word wrap** for horizontal scrolling and toggle **Line numbers** independently. Choose **Small**, **Standard** or **Large** to resize the note and line numbers. Font size, word wrap and line numbers are saved in this browser and shared across spaces for the active account. The note and file tabs use the available desktop width with side margins. On desktop, the note editor fills the height left between the toolbar and the status row. The editor uses the locally served IBM Plex Mono font and adjusts to the visible viewport when the mobile keyboard opens. The editor uses CodeMirror and Yjs, bundled with esbuild. The generated bundle is excluded from Git. Run `npm run build` to refresh it while the server is running. The Docker image builds and includes its own bundle.

See the [glossary](GLOSSARY.md), the [encryption design](docs/adr/0001-client-side-e2e-zero-knowledge.md) and the [Live-Sync design](docs/adr/0002-yjs-live-sync-encrypted-relay.md).
