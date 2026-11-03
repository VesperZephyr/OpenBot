import { extendTailwindMerge } from "tailwind-merge";

// Prefixed typography aliases must stay in the font-size group. Otherwise
// tailwind-merge treats `ob:text-body-medium` as a text color and drops it
// beside `ob:text-text-primary`.
const TEXT_STYLES = ["body-medium", "body-regular", "body-2-medium", "caption-1-semibold"] as const;

const twMerge = extendTailwindMerge({
	prefix: "ob",
	extend: {
		classGroups: {
			"font-size": [{ text: [...TEXT_STYLES] }],
		},
	},
});

export const cx = twMerge;

export function sortCx<
	T extends Record<string, string | number | Record<string, string | number | Record<string, string | number>>>,
>(classes: T): T {
	return classes;
}
