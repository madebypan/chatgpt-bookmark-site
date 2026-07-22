import { env } from "cloudflare:workers";

type ArchiveBindings = {
  ARCHIVE?: R2Bucket;
};

function getArchive(): R2Bucket {
  const archive = (env as unknown as ArchiveBindings).ARCHIVE;
  if (!archive) {
    throw new Error(
      "Cloudflare R2 binding `ARCHIVE` is unavailable. Set the `r2` field in .openai/hosting.json to `ARCHIVE` and deploy through Sites.",
    );
  }
  return archive;
}

export function artifactKeys(id: string, rawExtension: string): {
  markdownKey: string;
  rawKey: string;
} {
  const safeExtension = /^[a-z\d]{1,8}$/i.test(rawExtension) ? rawExtension.toLowerCase() : "bin";
  return {
    markdownKey: `bookmarks/${id}/content.md`,
    rawKey: `bookmarks/${id}/source.${safeExtension}`,
  };
}

export function previewImageKey(id: string): string {
  return `bookmarks/${id}/preview`;
}

export async function putArtifacts(input: {
  id: string;
  markdown: string;
  raw: Uint8Array;
  rawExtension: string;
  rawContentType: string;
}): Promise<{ markdownKey: string; rawKey: string }> {
  const keys = artifactKeys(input.id, input.rawExtension);
  const archive = getArchive();
  await Promise.all([
    archive.put(keys.markdownKey, input.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { bookmarkId: input.id, artifact: "clean-markdown" },
    }),
    archive.put(keys.rawKey, input.raw, {
      httpMetadata: { contentType: input.rawContentType || "application/octet-stream" },
      customMetadata: { bookmarkId: input.id, artifact: "raw-source" },
    }),
  ]);
  return keys;
}

export async function getArchiveText(key: string): Promise<string | null> {
  const object = await getArchive().get(key);
  return object ? object.text() : null;
}

export async function getArchiveObject(key: string): Promise<R2ObjectBody | null> {
  return getArchive().get(key);
}

export async function putPreviewImage(input: {
  id: string;
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
}): Promise<string> {
  const key = previewImageKey(input.id);
  await getArchive().put(key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
    customMetadata: {
      bookmarkId: input.id,
      artifact: "preview-image",
      sourceUrl: input.sourceUrl.slice(0, 1_800),
    },
  });
  return key;
}

export async function getPreviewImage(id: string, key: string): Promise<R2ObjectBody | null> {
  if (key !== previewImageKey(id)) return null;
  return getArchive().get(key);
}

export async function deleteArtifacts(keys: Array<string | null | undefined>): Promise<void> {
  const present = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  if (present.length === 0) return;
  await getArchive().delete(present);
}
