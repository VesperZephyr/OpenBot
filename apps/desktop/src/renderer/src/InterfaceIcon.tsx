import {
	ArrowDownToLine,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BookOpen,
	ChevronRight,
	FileText,
	Folder,
	Globe,
	Info,
	Minus,
	PanelRight,
	Plug,
	Plus,
	RotateCw,
	Search,
	SlidersHorizontal,
	Sun,
	Users,
	X,
} from "lucide-react";

const icons = {
	file: FileText,
	folder: Folder,
	web: Globe,
	close: X,
	minus: Minus,
	back: ArrowLeft,
	forward: ArrowRight,
	refresh: RotateCw,
	chevron: ChevronRight,
	panel: PanelRight,
	export: ArrowDownToLine,
	search: Search,
	routines: Sun,
	apps: Plug,
	skills: BookOpen,
	settings: SlidersHorizontal,
	info: Info,
	plus: Plus,
	arrow: ArrowUp,
	group: Users,
};
export function InterfaceIcon({ name }: { name: keyof typeof icons }) {
	const Icon = icons[name];
	return <Icon className="interface-icon" size={19} strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}
export function BrandSymbol() {
	return (
		<svg className="brand-symbol" viewBox="0 0 32 32" aria-hidden="true">
			<circle cx="14" cy="18" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
			<circle cx="23" cy="6" r="3" fill="var(--brand-dot)" />
		</svg>
	);
}
