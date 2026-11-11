import { loadConfig, type Config } from "./config.ts";
import { startServer } from "./server.ts";

const config = loadConfigOrExit();
const running = await startServer(config).catch((cause) => {
  console.error(`share-tool: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
console.log(`share-tool listening on port ${running.port} (all interfaces)`);
console.log(`Share Links build from ${config.baseUrl} (set BASE_URL to change this)`);

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  running.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(reason);
  process.exit(1);
});

/** Loads configuration; an invalid environment fails boot with a clear message. */
function loadConfigOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (cause) {
    console.error(`share-tool: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}
