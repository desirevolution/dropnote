import { countDeletedReferences } from "../src/reference-deletion.ts";
import { t } from "./i18n.js";

export function referenceDeleteMessage(message, text, spaceId, blobIds) {
  const count = countDeletedReferences(text, spaceId, blobIds);
  return count ? `${message}\n\n${t("The current note contains {count} references to this deletion.", { count })}\n${t("These references are not removed automatically. Other spaces have not been checked.")}` : message;
}
