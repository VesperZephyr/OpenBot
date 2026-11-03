import { join } from "node:path";
import { expect, it } from "vitest";
import { readerNotices } from "../scripts/reader-notices.mjs";

it("copies notices for the BoardUI runtime dependencies", () => {
	const targets = readerNotices(join(import.meta.dirname, "../node_modules"));
	const destinations = targets.map((target: { dest: string }) => target.dest);
	expect(destinations.some((dest: string) => dest.includes("react-aria-components@1.17.0"))).toBe(true);
	expect(destinations.some((dest: string) => dest.includes("tailwind-merge@3.6.0"))).toBe(true);
	expect(destinations.some((dest: string) => dest.includes("react-aria@"))).toBe(true);
});
