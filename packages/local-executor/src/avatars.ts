import { createHash } from "node:crypto";
import { extname } from "node:path";
import { PNG } from "pngjs";
import { AVATAR_LIMITS as L, type AvatarSource, type AvatarImage } from "@openbot/protocol";
import { selectedPath, bytesAt, imageSize } from "./artifacts.ts";
const invalid = (): never => {
	throw new Error("Choose a valid PNG, JPEG or WebP image up to 5 MB and 4096 pixels per side.");
};
function bounded(width: number, height: number): void {
	if (!width || !height || width > L.side || height > L.side || width * height > L.pixels) invalid();
}
function webpSize(bytes: Buffer): [number, number] {
	if (
		bytes.length < 20 ||
		bytes.toString("ascii", 0, 4) !== "RIFF" ||
		bytes.toString("ascii", 8, 12) !== "WEBP" ||
		bytes.readUInt32LE(4) !== bytes.length - 8
	)
		invalid();
	let frame: [number, number] | undefined, canvas: [number, number] | undefined;
	for (let p = 12; p < bytes.length;) {
		if (p + 8 > bytes.length) invalid();
		const kind = bytes.toString("ascii", p, p + 4),
			size = bytes.readUInt32LE(p + 4),
			start = p + 8;
		if (start + size > bytes.length) invalid();
		const chunk = bytes.subarray(start, start + size);
		if (kind === "VP8X") {
			if (size !== 10 || chunk[0]! & 2) invalid();
			canvas = [chunk.readUIntLE(4, 3) + 1, chunk.readUIntLE(7, 3) + 1];
			bounded(...canvas);
		} else if (kind === "VP8 " || kind === "VP8L") {
			if (frame) invalid();
			if (kind === "VP8 ") {
				if (size < 10 || chunk.subarray(3, 6).toString("hex") !== "9d012a") invalid();
				frame = [chunk.readUInt16LE(6) & 0x3fff, chunk.readUInt16LE(8) & 0x3fff];
			} else {
				if (size < 5 || chunk[0] !== 0x2f) invalid();
				const bits = chunk.readUInt32LE(1);
				frame = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
			}
			bounded(...frame);
		} else if (kind === "ANIM" || kind === "ANMF") invalid();
		p = start + size + (size % 2);
	}
	if (!frame || (canvas && (canvas[0] !== frame[0] || canvas[1] !== frame[1]))) invalid();
	return frame!;
}
/** Read only the native-selected regular file. This creates no asset or grant. */
export function avatarSource(path: string): AvatarSource {
	const bytes = bytesAt(selectedPath(path), L.sourceBytes),
		ext = extname(path).toLowerCase();
	const mediaType =
		ext === ".png"
			? "image/png"
			: [".jpg", ".jpeg"].includes(ext)
				? "image/jpeg"
				: ext === ".webp"
					? "image/webp"
					: invalid();
	const size = mediaType === "image/webp" ? webpSize(bytes) : imageSize(bytes, mediaType);
	bounded(...size);
	return { mediaType, base64: bytes.toString("base64") };
}
/** Decode only the fixed-size, noninterlaced preview; strip all source metadata. */
export function validateAvatar(base64: string): AvatarImage {
	if (base64.length > Math.ceil(L.pngBytes / 3) * 4) invalid();
	const bytes = Buffer.from(base64, "base64");
	if (bytes.toString("base64") !== base64 || bytes.length > L.pngBytes) invalid();
	const [width, height] = imageSize(bytes, "image/png");
	if (width !== L.size || height !== L.size || bytes[24] !== 8 || ![2, 6].includes(bytes[25]!) || bytes[28] !== 0)
		invalid();
	try {
		const image = PNG.sync.read(bytes, { checkCRC: true });
		const png = PNG.sync.write({ width: L.size, height: L.size, data: image.data } as PNG, {
			colorType: 6,
			bitDepth: 8,
		});
		if (png.length > L.pngBytes) invalid();
		return { sha256: createHash("sha256").update(png).digest("hex"), base64: png.toString("base64") };
	} catch {
		throw new Error("Could not read this avatar. Choose another image.");
	}
}
