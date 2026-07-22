export function buildFtsMatchQuery(
  query: string,
  maximumTerms = 6,
): string | null {
  const normalized = query
    .replace(/[\u0000-\u001f\u007f"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("und");
  if (!normalized) return null;

  const parts = [normalized, ...normalized.split(/\s+/u)]
    .map((part) => part.trim())
    .filter((part) => [...part].length >= 3);
  const unique = [...new Set(parts)].slice(0, Math.max(1, maximumTerms));
  if (!unique.length) return null;

  // Every term is quoted after control characters and quotes are removed, so
  // user input cannot become an FTS operator such as OR, NEAR, or a prefix `*`.
  return unique.map((part) => `"${part}"`).join(" OR ");
}
