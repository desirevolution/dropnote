/**
 * Deployment smoke test (ticket 09): builds the Docker image, boots a
 * container with a temporary data volume and runs the API smoke facts
 * against it — the same black-box seam the rest of the suite drives, with
 * Docker as the lifecycle driver. Also verifies the deployment contracts
 * the image promises: it runs non-root (UID 1000), the documented data-dir
 * ownership works, a wrong owner fails boot with the permission error, and
 * data in the volume survives container replacement.
 *
 * HTTP requests are sent from inside the container (`docker exec` + node's
 * fetch, marshalled as JSON): the test runner may not share a network with
 * the Docker daemon (remote or sandboxed daemons publish ports into a
 * namespace the runner cannot reach), while `docker exec` always works.
 * The host-side port mapping is Docker's concern, not the app's.
 *
 * Skips cleanly with a clear message when Docker is unavailable.
 */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeTempDataDir } from "./helpers/server.ts";
import {
  assertApiSmokeFacts,
  type PadMetadata,
  type Probe,
  type ProbeResponse,
} from "./helpers/smoke.ts";

const execFile = promisify(execFileCallback);

/** The image this suite builds; tagged so unrelated images cannot collide with it. */
const IMAGE = "share-tool:smoke-test";
/** Broad label for debris sweeps: every container the suite ever created. */
const LABEL = "share-tool-smoke-test";
/** Unique per run, so two parallel test runs never fight over a name. */
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;

/**
 * Runs inside the container: performs one HTTP request against the local
 * server (PORT 3000, the image's default) and prints the marshalled response.
 */
const PROBE_SCRIPT = `
const [path, initJson] = process.argv.slice(-2);
const response = await fetch("http://127.0.0.1:3000" + path, JSON.parse(initJson));
process.stdout.write(JSON.stringify({
  status: response.status,
  contentType: response.headers.get("content-type") ?? "",
  body: await response.text(),
}));
`;

interface DockerOutput {
  stdout: string;
  stderr: string;
}

async function docker(args: string[], options: { timeoutMs?: number } = {}): Promise<DockerOutput> {
  return execFile("docker", args, { timeout: options.timeoutMs ?? 30_000 });
}

/** The Docker server version, or null when Docker is unavailable. */
async function dockerServerVersion(): Promise<string | null> {
  try {
    return (await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 })).stdout.trim();
  } catch {
    return null;
  }
}

/** Skips the test when Docker is not usable; returns the server version otherwise. */
async function requireDocker(t: TestContext): Promise<string> {
  const version = await dockerServerVersion();
  if (version === null) {
    t.skip("Docker is not available — skipping the deployment smoke test");
  }
  return version ?? "";
}

let imageBuild: Promise<void> | undefined;

/** Builds the image once per run; Docker's layer cache makes repeat calls cheap. */
function ensureImage(): Promise<void> {
  return (imageBuild ??= (async () => {
    await sweepLeftovers();
    try {
      // --load: keep the image in the local store (the container driver
      // leaves build results in the cache only).
      await docker(["build", "--quiet", "--load", "--label", LABEL, "-t", IMAGE, "."], { timeoutMs: 600_000 });
    } catch (cause) {
      imageBuild = undefined; // a fixed Dockerfile must rebuild on the next attempt
      const stderr = cause instanceof Error && "stderr" in cause ? String((cause as { stderr?: string }).stderr) : "";
      throw new Error(`docker build failed: ${stderr || cause}`);
    }
  })()) as Promise<void>;
}

/** Removes containers left behind by an earlier crashed run of this suite. */
async function sweepLeftovers(): Promise<void> {
  const { stdout } = await docker(["ps", "-aq", "--filter", `label=${LABEL}`]);
  for (const id of stdout.split("\n").filter(Boolean)) {
    await forceRemove(id);
  }
}

interface RunningContainer {
  name: string;
  /** A probe that performs HTTP requests from inside the container. */
  probe: Probe;
  /** Stops the container (SIGTERM, docker-style) and waits for its removal. */
  stop(): Promise<void>;
}

async function startContainer(name: string, volumeDir: string): Promise<RunningContainer> {
  await docker(["run", "-d", "--rm", "--name", name, "--label", `${LABEL}=1`, "-v", `${volumeDir}:/app/data`, IMAGE]);
  await waitForReady(name);
  return {
    name,
    probe: execProbe(name),
    stop: () => stopContainer(name),
  };
}

/** Performs one HTTP request from inside the container, via `docker exec`. */
function execProbe(name: string): Probe {
  return async (path, request = {}) => {
    const { stdout } = await docker([
      "exec", name, "node", "--input-type=module", "-e", PROBE_SCRIPT, path, JSON.stringify(request),
    ]);
    return JSON.parse(stdout) as ProbeResponse;
  };
}

/** Polls the container's HTTP root until it answers, with a hard timeout. */
async function waitForReady(name: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  const probe = execProbe(name);
  for (;;) {
    try {
      if ((await probe("/")).status === 200) return;
    } catch {
      const status = await containerStatus(name);
      if (status !== "running") {
        throw new Error(`the container ${status} before becoming ready; logs:\n${await dockerLogs(name)}`);
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`the container never became ready; logs:\n${await dockerLogs(name)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function containerStatus(name: string): Promise<string> {
  try {
    return (await docker(["inspect", "--format", "{{.State.Status}}", name])).stdout.trim();
  } catch {
    return "gone";
  }
}

/** Both the container's output streams: the server logs its failures to stderr. */
async function dockerLogs(name: string): Promise<string> {
  try {
    const { stdout, stderr } = await docker(["logs", name]);
    return `${stdout}${stderr}`.trim() || "(the container printed nothing)";
  } catch {
    return "(logs unavailable — container is gone)";
  }
}

/** Stops a container and waits for --rm to remove it; tolerates an already-gone one. */
async function stopContainer(name: string): Promise<void> {
  try {
    await docker(["stop", "-t", "10", name], { timeoutMs: 30_000 });
  } catch {
    await forceRemove(name);
  }
}

async function forceRemove(name: string): Promise<void> {
  try {
    await docker(["rm", "-f", name]);
  } catch {
    // already gone
  }
}

/**
 * Hands a volume directory to the container's user (UID 1000) — the exact
 * command the README documents for preparing a data directory.
 */
async function chownVolume(volumeDir: string, uid: number, gid: number): Promise<void> {
  await docker(["run", "--rm", "-u", "root", "-v", `${volumeDir}:/mnt`, IMAGE, "chown", "-R", `${uid}:${gid}`, "/mnt"]);
}

/** Restores the host user's ownership so the suite can delete the volume. */
async function releaseVolume(volumeDir: string): Promise<void> {
  await chownVolume(volumeDir, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
}

async function createPad(probe: Probe, slug: string): Promise<void> {
  const response = await probe("/api/pads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, ttl: "never" }),
  });
  assert.equal(response.status, 201, `creating the Pad "${slug}" must succeed`);
}

test("deployment: the image serves the API smoke facts as a non-root container", async (t) => {
  await requireDocker(t);
  await ensureImage();

  const volumeDir = await makeTempDataDir();
  try {
    // The documented data-dir ownership: the container's user owns the volume.
    await chownVolume(volumeDir, 1000, 1000);
    const container = await startContainer(`${RUN_ID}-facts`, volumeDir);
    try {
      await assertApiSmokeFacts(container.probe);

      await t.test("the container runs as non-root UID 1000", async () => {
        const uid = (await docker(["exec", container.name, "id", "-u"])).stdout.trim();
        assert.equal(uid, "1000", "the container process must not run as root");
      });

      await t.test("the data directory is owned by UID 1000", async () => {
        const uid = (await docker(["exec", container.name, "stat", "-c", "%u", "/app/data"])).stdout.trim();
        assert.equal(uid, "1000", "the volume's owner must match the container user");
      });
    } finally {
      await container.stop();
    }
  } finally {
    await releaseVolume(volumeDir);
    await rm(volumeDir, { recursive: true, force: true });
  }
});

test("deployment: data in the volume survives container replacement", async (t) => {
  await requireDocker(t);
  await ensureImage();

  const volumeDir = await makeTempDataDir();
  try {
    await chownVolume(volumeDir, 1000, 1000);

    const first = await startContainer(`${RUN_ID}-first`, volumeDir);
    let defaultPadBefore: PadMetadata;
    try {
      defaultPadBefore = await assertApiSmokeFacts(first.probe);
      await createPad(first.probe, "smoke-check");
    } finally {
      await first.stop();
    }

    // A replacement container on the same volume: fresh process, same data.
    const second = await startContainer(`${RUN_ID}-second`, volumeDir);
    try {
      const defaultPadAfter = await assertApiSmokeFacts(second.probe);
      assert.equal(
        defaultPadAfter.createdAt,
        defaultPadBefore.createdAt,
        "the Default Pad record is reused from the volume, not reseeded",
      );

      const pad = await second.probe("/p/smoke-check");
      assert.equal(pad.status, 200, "the Pad created before the replacement is still served");
      assert.match(pad.contentType, /^text\/html/);
    } finally {
      await second.stop();
    }
  } finally {
    await releaseVolume(volumeDir);
    await rm(volumeDir, { recursive: true, force: true });
  }
});

test("deployment: a data directory with the wrong owner fails boot with the permission error", async (t) => {
  await requireDocker(t);
  await ensureImage();

  const volumeDir = await makeTempDataDir();
  try {
    if (statSync(volumeDir).uid === 1000) {
      t.skip("the test user is UID 1000 — a foreign owner cannot be simulated without root");
      return;
    }

    // No chown: the directory belongs to the test user, not to the container's UID 1000.
    const name = `${RUN_ID}-eacces`;
    await docker(["run", "-d", "--name", name, "--label", `${LABEL}=1`, "-v", `${volumeDir}:/app/data`, IMAGE]);
    try {
      const exitCode = (await docker(["wait", name], { timeoutMs: 60_000 })).stdout.trim();
      assert.notEqual(exitCode, "0", "boot must fail when the data directory is not writable");
      const logs = await dockerLogs(name);
      assert.match(logs, /EACCES|permission denied/i, "the failure is the documented permission error");
      assert.match(logs, /DATA_DIR|\/app\/data/, "the error points at the data directory");
    } finally {
      await forceRemove(name);
    }
  } finally {
    await rm(volumeDir, { recursive: true, force: true });
  }
});
