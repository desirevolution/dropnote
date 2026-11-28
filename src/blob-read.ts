import { closeSync, createReadStream, fstatSync, openSync } from "node:fs";

/** Pin the authorized file identity before yielding to the event loop. A
 * deleted/recreated slug or pathname cannot redirect an in-flight download. */
export function openBlobRead(path: string) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Not an attachment file");
    return { size: stat.size, stream: createReadStream(path, { fd, autoClose: true }) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
