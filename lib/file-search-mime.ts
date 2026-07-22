export function supportedFileSearchRawMime(
  value: string,
  supportsMultimodal: boolean,
): boolean {
  if (!value || value === "text/html" || value === "application/xhtml+xml") return false;
  if (value.startsWith("audio/") || value.startsWith("video/")) return false;
  return (supportsMultimodal && (value === "image/png" || value === "image/jpeg")) ||
    value.startsWith("text/") ||
    value === "application/pdf" ||
    value === "application/json" ||
    value === "application/msword" ||
    value === "application/vnd.ms-excel" ||
    value === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    value === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    value === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    value === "application/vnd.oasis.opendocument.text";
}
