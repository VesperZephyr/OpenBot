import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { avatarSource, validateAvatar } from "../src/avatars.ts";
let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "openbot-avatar-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function png() {
	return PNG.sync.write(new PNG({ width: 256, height: 256 }), { colorType: 6 });
}
const file = (name: string, bytes: Buffer | string) => {
	const path = join(root, name);
	writeFileSync(path, bytes);
	return path;
};
it("reads only a bounded selected image and reencodes a stable metadata-free PNG", () => {
	const source = avatarSource(file("photo.png", png()));
	expect(source.mediaType).toBe("image/png");
	const saved = validateAvatar(source.base64);
	expect(saved.sha256).toBe(createHash("sha256").update(Buffer.from(saved.base64, "base64")).digest("hex"));
	expect(validateAvatar(saved.base64)).toEqual(saved);
	expect(PNG.sync.read(Buffer.from(saved.base64, "base64"))).toMatchObject({ width: 256, height: 256 });
});
it("rejects symlinks, directories, large sources and unsupported files before decoding", () => {
	const path = file("photo.png", png());
	symlinkSync(path, join(root, "link.png"));
	for (const path of [
		join(root, "link.png"),
		root,
		file("photo.svg", "<svg/>"),
		file("large.png", Buffer.alloc(5 * 1024 * 1024 + 1)),
	])
		expect(() => avatarSource(path)).toThrow();
});
it("rejects oversized PNG dimensions, corrupt data, non-square previews and unbounded formats", () => {
	const huge = png();
	huge.writeUInt32BE(5000, 16);
	expect(() => avatarSource(file("huge.png", huge))).toThrow();
	const corrupt = png();
	corrupt[corrupt.length - 5]! ^= 1;
	const nonsquare = PNG.sync.write(new PNG({ width: 128, height: 256 }));
	const interlaced = png();
	interlaced[28] = 1;
	for (const bytes of [huge, corrupt, nonsquare, interlaced, Buffer.from("not a PNG")])
		expect(() => validateAvatar(bytes.toString("base64"))).toThrow();
	expect(() => validateAvatar(png().toString("base64") + "!!")).toThrow();
});
it("checks WebP frame dimensions and refuses animation before native decoding", () => {
	const bytes = Buffer.alloc(30);
	bytes.write("RIFF", 0);
	bytes.writeUInt32LE(22, 4);
	bytes.write("WEBPVP8 ", 8);
	bytes.writeUInt32LE(10, 16);
	bytes.write("9d012a", 23, "hex");
	bytes.writeUInt16LE(32, 26);
	bytes.writeUInt16LE(32, 28);
	expect(avatarSource(file("header.webp", bytes)).mediaType).toBe("image/webp");
	bytes.writeUInt16LE(5000, 26);
	expect(() => avatarSource(file("huge.webp", bytes))).toThrow();
	const animated = Buffer.alloc(30);
	animated.write("RIFF", 0);
	animated.writeUInt32LE(22, 4);
	animated.write("WEBPVP8X", 8);
	animated.writeUInt32LE(10, 16);
	animated[20] = 2;
	expect(() => avatarSource(file("animated.webp", animated))).toThrow();
});
