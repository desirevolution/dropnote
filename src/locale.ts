export type Language = "en" | "de";

export function detectLanguage(header = ""): Language {
  const preferred = header.split(",").map((entry) => {
    const [tag = "", weight] = entry.trim().toLowerCase().split(";");
    return { language: tag.split("-")[0], quality: weight ? Number(weight.trim().replace(/^q=/, "")) : 1 };
  }).filter(({ quality }) => quality > 0 && quality <= 1).sort((a, b) => b.quality - a.quality);
  return preferred.find(({ language }) => language === "de" || language === "en")?.language === "de" ? "de" : "en";
}
