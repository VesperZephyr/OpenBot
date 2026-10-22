import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
	file: (
		<>
			<path d="M6 2h8l4 4v16H6V2Zm8 0v5h4M9 12h6m-6 4h6" />
		</>
	),
	search: (
		<>
			<circle cx="10.5" cy="10.5" r="6.5" />
			<path d="m16 16 4.5 4.5" />
		</>
	),
	routines: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
		</>
	),
	apps: (
		<>
			<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4" />
		</>
	),
	skills: (
		<>
			<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15" />
		</>
	),
	settings: (
		<>
			<path d="M3 6h6m4 0h8M3 12h12m4 0h2M3 18h3m4 0h11" />
			<circle cx="11" cy="6" r="2" />
			<circle cx="17" cy="12" r="2" />
			<circle cx="8" cy="18" r="2" />
		</>
	),
	info: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v6m0-10v.1" />
		</>
	),
	plus: <path d="M12 4v16M4 12h16" />,
	arrow: <path d="m6 11 6-6 6 6M12 5v15" />,
	group: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m3 9v-3a6 6 0 0 0-2-4" />
		</>
	),
};
export function InterfaceIcon({ name }: { name: keyof typeof paths }) {
	return (
		<svg
			className="interface-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{paths[name]}
		</svg>
	);
}
export function BrandSymbol() {
	return (
		<svg className="brand-symbol" viewBox="0 0 32 32" aria-hidden="true">
			<circle cx="14" cy="18" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
			<circle cx="23" cy="6" r="3" fill="var(--brand-dot)" />
		</svg>
	);
}
