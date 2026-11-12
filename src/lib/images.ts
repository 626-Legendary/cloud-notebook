export const imageTypes = [
  { mime: "image/jpeg", extension: "jpg", valid: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: "image/png", extension: "png", valid: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/webp", extension: "webp", valid: (bytes: Buffer) => bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" },
  { mime: "image/gif", extension: "gif", valid: (bytes: Buffer) => bytes.subarray(0, 3).toString() === "GIF" }
] as const;

export function detectImage(bytes: Buffer) {
  return imageTypes.find((signature) => signature.valid(bytes));
}

export function extensionForMime(mime: string) {
  return imageTypes.find((type) => type.mime === mime)?.extension;
}
