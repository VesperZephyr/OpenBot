import type { GeneratedAvatar } from "@openbot/protocol";

/**
 * V1 seed mapping. Color index and shape stay stable for saved recipes.
 * Avatar.tsx is the only renderer; this module exists so tests can lock the
 * mapping without loading the renderer store.
 */
export function generatedAvatarAppearance(recipe: GeneratedAvatar): { readonly colorIndex: number; readonly shape: 0 | 1 | 2 } {
	const seed = recipe.seed >>> 0;
	return { colorIndex: seed % 6, shape: (Math.floor(seed / 6) % 3) as 0 | 1 | 2 };
}

/** Same six slots as V1, drawn more saturated. Index order is the mapping. */
export const AVATAR_PALETTES = [
	["#b794f6", "#3b2760", "#f6e27a"],
	["#5cbf86", "#1a4332", "#f3c56a"],
	["#f0a15a", "#6a341f", "#d7c0f2"],
	["#6aade8", "#1d3550", "#e6e07a"],
	["#f09ab8", "#6a3044", "#c9e09a"],
	["#d0d25a", "#3c461c", "#dcc6ee"],
] as const;
