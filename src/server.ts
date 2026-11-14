import { createServer, type Server } from "node:http";
import { createApp } from "./app.ts";
import { PadStore } from "./store.ts";
import { SyncRelay } from "./relay.ts";
import { PinAuthority } from "./pin.ts";
import { startCleanupSweep } from "./cleanup.ts";
import type { Config } from "./config.ts";

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Opens the data store, builds the app and starts listening. */
export async function startServer(config: Config): Promise<RunningServer> {
  const store = PadStore.open(config.dataDir, config.trustedProxies !== null);
  const pins = new PinAuthority({ lockoutSeconds: config.pinLockoutSeconds });
  const relay = new SyncRelay(store, pins, config);
  const onPadDeleted = (slug: string) => {
    pins.revokePad(slug);
    const pad = store.getPad(slug);
    if (pad?.owner) relay.notifyAccount(pad.owner);
    for (const grant of pad?.grants ?? []) relay.notifyAccount(grant.username);
    relay.forget(slug);
  };
  const app = createApp(store, config, {
    pins,
    onPadDeleted,
    notifyAccount: (username) => relay.notifyAccount(username),
    onAttachmentChanged: (slug) => relay.attachmentChanged(slug),
    guestUpdates: (pad) => relay.guestUpdates(pad),
    scriptUpdate: (pad, apply) => relay.updatePlainPad(pad, apply),
    padRevision: (pad) => relay.revision(pad),
    onGrantChanged: (slug, username, role) => {
      pins.revokeUser(slug, username);
      relay.accessChanged(slug, username, role);
      relay.notifyAccount(username);
    },
    onExpiryChanged: (slug, expiresAt) => relay.updateExpiry(slug, expiresAt),
  });
  const sweep = startCleanupSweep({
    store,
    intervalMs: config.cleanupSweepSeconds * 1_000,
    onPadDeleted,
  });

  const server: Server = createServer(app);
  relay.attach(server);

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(config.port);
  });

  const address = server.address();
  const port = address && typeof address === "object" ? address.port : config.port;

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        // closeAllConnections so keep-alive clients do not delay shutdown.
        sweep.stop();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
        void relay.close();
      }),
  };
}
