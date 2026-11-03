import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx, sortCx } from "../../../utils/cx";

type ButtonSize = "medium" | "choice";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	size?: ButtonSize;
	iconOnly?: boolean;
	icon?: ReactNode;
	children?: ReactNode;
	ref?: Ref<HTMLButtonElement>;
}

const styles = sortCx({
	base: [
		"ob:inline-flex ob:items-center ob:justify-center ob:gap-1",
		"ob:font-sans ob:select-none ob:cursor-pointer",
		"ob:outline-none ob:focus-visible:ring-2 ob:focus-visible:ring-offset-2 ob:focus-visible:ring-accent",
		"ob:disabled:cursor-not-allowed ob:disabled:opacity-45",
	].join(" "),
	size: {
		medium: "ob:min-h-9 ob:rounded-2lg ob:px-2 ob:text-body-medium",
		choice: "ob:h-auto ob:min-h-9 ob:w-full ob:flex-col ob:items-start ob:whitespace-normal ob:rounded-lg ob:px-3.5 ob:py-3 ob:text-start",
	},
	iconOnly: "ob:size-9 ob:min-h-8 ob:min-w-8 ob:shrink-0 ob:p-0",
	neutral: [
		"ob:border ob:border-muted ob:bg-surface ob:text-text-primary ob:shadow-xs",
		"ob:hover:bg-surface-raised",
	].join(" "),
});

export function Button({
	size = "medium",
	iconOnly = false,
	icon,
	children,
	className,
	type = "button",
	ref,
	...props
}: ButtonProps) {
	return (
		<button ref={ref} type={type} className={cx(styles.base, styles.size[size], styles.neutral, iconOnly && styles.iconOnly, className)} {...props}>
			{icon}
			{!iconOnly && children !== undefined && children !== null ? <span className={size === "choice" ? "ob:flex ob:w-full ob:flex-col ob:items-start ob:gap-1 ob:whitespace-normal" : "ob:inline-flex ob:items-center ob:px-1"}>{children}</span> : null}
		</button>
	);
}
