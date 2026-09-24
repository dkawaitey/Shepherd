/**
 * Shared helpers for the attachments a post or comment can carry: image
 * optimisation, thumbnails, and the upload + media-item shape that
 * `posts.create` / `posts.addComment` expect.
 *
 * Kept out of the page components so the composer, the comment thread and any
 * future surface (dashboard quick actions) all produce identical media items.
 */

/** One attachment, exactly as the server stores and validates it. */
export type UploadedMedia = {
  storageId: string;
  type: string; // "image" | "video" | "audio" | "file"
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  /** Seconds, for audio and video. */
  duration?: number;
  thumbnailStorageId?: string;
  status: string;
  uploadedAt: number;
};

/** Longest edge we keep for images (browser-side downscale). */
export const MAX_IMAGE_DIM = 1920;
/** Longest edge of the generated grid thumbnail. */
export const THUMB_SIZE = 320;

/** Strip codec parameters: "audio/webm;codecs=opus" -> "audio/webm". */
export function baseMime(mime: string) {
  return mime.split(";")[0].trim().toLowerCase();
}

export function classifyMime(mime: string): "image" | "video" | "audio" | "file" {
  const m = baseMime(mime);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

/** A sane file extension for a recording, so the attachment is named properly. */
export function voiceExtension(mime: string) {
  const base = baseMime(mime);
  if (base.includes("mp4")) return "m4a";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("wav")) return "wav";
  if (base.includes("mpeg")) return "mp3";
  return "webm";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Downscale + recompress a photo so posts stay light. */
export async function optimizeImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) =>
          blob ? resolve({ blob, width: w, height: h }) : reject(new Error("Compress failed")),
        "image/jpeg",
        0.82,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

/** Small square-ish preview used in grids. */
export async function generateThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > THUMB_SIZE || h > THUMB_SIZE) {
        const scale = THUMB_SIZE / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Thumbnail failed"))),
        "image/jpeg",
        0.75,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

/** POST one blob to a signed Convex upload URL and return its storage id. */
async function uploadBlob(
  blob: Blob,
  mimeType: string,
  generateUploadUrl: () => Promise<string>,
): Promise<string> {
  const uploadUrl = await generateUploadUrl();
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: blob,
  });
  if (!res.ok) throw new Error("Upload failed");
  const { storageId } = (await res.json()) as { storageId: string };
  return storageId;
}

/**
 * Upload a finished voice note and shape it as a media item.
 * Duration is what the animated player starts from before metadata loads.
 */
export async function uploadVoiceNote({
  blob,
  mimeType,
  durationMs,
  generateUploadUrl,
}: {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  generateUploadUrl: () => Promise<string>;
}): Promise<UploadedMedia> {
  const clean = baseMime(mimeType) || "audio/webm";
  const storageId = await uploadBlob(blob, clean, generateUploadUrl);
  return {
    storageId,
    type: "audio",
    name: `voice-note.${voiceExtension(clean)}`,
    mimeType: clean,
    size: blob.size,
    duration: Math.round(durationMs / 100) / 10,
    status: "ready",
    uploadedAt: Date.now(),
  };
}

/**
 * Upload a picked file. Images are downscaled and given a thumbnail first;
 * if either step fails we still upload the original rather than lose the post.
 */
export async function uploadPickedFile({
  file,
  generateUploadUrl,
}: {
  file: File;
  generateUploadUrl: () => Promise<string>;
}): Promise<UploadedMedia> {
  const category = classifyMime(file.type);

  if (category === "image") {
    try {
      const optimized = await optimizeImage(file);
      const clean = "image/jpeg";
      const storageId = await uploadBlob(optimized.blob, clean, generateUploadUrl);
      let thumbnailStorageId: string | undefined;
      try {
        const thumb = await generateThumbnail(file);
        thumbnailStorageId = await uploadBlob(thumb, clean, generateUploadUrl);
      } catch {
        /* a missing thumbnail is fine */
      }
      return {
        storageId,
        type: "image",
        name: file.name,
        mimeType: clean,
        size: optimized.blob.size,
        width: optimized.width,
        height: optimized.height,
        thumbnailStorageId,
        status: "ready",
        uploadedAt: Date.now(),
      };
    } catch {
      /* fall through to the untouched file */
    }
  }

  const clean = baseMime(file.type) || "application/octet-stream";
  const storageId = await uploadBlob(file, clean, generateUploadUrl);
  return {
    storageId,
    type: category,
    name: file.name,
    mimeType: clean,
    size: file.size,
    status: "ready",
    uploadedAt: Date.now(),
  };
}
