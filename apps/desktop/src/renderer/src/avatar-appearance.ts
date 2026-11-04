/** V1 seed mapping. Color index and shape stay stable; Avatar.tsx only paints them. */
export function avatarColorIndex(seed: number): number {
	return (seed >>> 0) % 6;
}
export function avatarShape(seed: number): 0 | 1 | 2 {
	return (Math.floor((seed >>> 0) / 6) % 3) as 0 | 1 | 2;
}
