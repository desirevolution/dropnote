import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIN_ENTRY = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

/** The line src/main.ts prints once the server accepts connections. */
const LISTEN_PATTERN = /share-tool listening on port (\d+) \(all interfaces\)/;

export interface RunningServer {
  baseUrl: string;
  port: number;
  /** The WebSocket Live-Sync endpoint for a Pad's Slug (ADR-0002). */
  syncUrl(slug: string): string;
  /** Stop the server (SIGTERM, escalating to SIGKILL) and wait for exit. */
  stop(): Promise<void>;
}

export interface ExitedServer {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** A fresh, empty data directory for one test run. */
export async function makeTempDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "share-tool-test-"));
}

function childEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: "0",
    ...overrides,
  };
}

interface Collected {
  text(): string;
  done: Promise<void>;
}

function collect(stream: NodeJS.ReadableStream): Collected {
  let text = "";
  stream.setEncoding("utf8");
  const done = new Promise<void>((resolve) => {
    stream.on("data", (chunk: string) => {
      text += chunk;
    });
    stream.on("end", resolve);
    stream.on("error", resolve);
  });
  return { text: () => text, done };
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  return { code, signal };
}

/**
 * Start the real server as a child process (black box over HTTP).
 * Resolves once the server reports its listening port; rejects if it
 * exits before becoming ready.
 */
export async function startServer(options: {
  dataDir: string;
  env?: Record<string, string | undefined>;
}): Promise<RunningServer> {
  const child = spawn(process.execPath, [MAIN_ENTRY], {
    env: childEnv({ DATA_DIR: options.dataDir, ...options.env }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const out = collect(child.stdout);
  const err = collect(child.stderr);

  const port = await new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`server did not report a port; stdout:\n${out.text()}\nstderr:\n${err.text()}`)), 10_000);
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const match = LISTEN_PATTERN.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    void waitForExit(child).then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`server exited before becoming ready (code=${code}, signal=${signal})\nstdout:\n${out.text()}\nstderr:\n${err.text()}`));
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await assertReachable(baseUrl);

  return {
    baseUrl,
    port,
    syncUrl: (slug: string) => `${baseUrl.replace(/^http/, "ws")}/sync/${slug}`,
    stop: () => stopChild(child),
  };
}

async function assertReachable(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error(`server at ${baseUrl} never became reachable`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_000))]);
  if (graceful === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
}

/**
 * Boot the server expecting it to exit on its own (invalid configuration);
 * returns the exit status and captured output instead of rejecting.
 */
export async function runServerUntilExit(options: {
  dataDir: string;
  env?: Record<string, string | undefined>;
}): Promise<ExitedServer> {
  const child = spawn(process.execPath, [MAIN_ENTRY], {
    env: childEnv({ DATA_DIR: options.dataDir, ...options.env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = collect(child.stdout);
  const err = collect(child.stderr);
  const { code, signal } = await waitForExit(child);
  await Promise.all([out.done, err.done]);
  return { code, signal, stdout: out.text(), stderr: err.text() };
}

/** Grab an unused TCP port (tiny race between close and rebind; acceptable for tests). */
export async function getFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error("could not determine a free port")));
      }
    });
    server.on("error", reject);
  });
}
