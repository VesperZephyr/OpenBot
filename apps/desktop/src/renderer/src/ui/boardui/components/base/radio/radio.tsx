import type { ReactNode, Ref } from "react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import type { RadioGroupProps as AriaRadioGroupProps, RadioProps as AriaRadioProps } from "react-aria-components";
import { cx } from "../../../utils/cx";

export interface RadioDotProps {
	selected?: boolean;
	focusVisible?: boolean;
	className?: string;
}

export function RadioDot({ selected = false, focusVisible = false, className }: RadioDotProps) {
	return (
		<span
			aria-hidden="true"
			className={cx(
				"ob:relative ob:flex ob:size-4 ob:shrink-0 ob:items-center ob:justify-center ob:rounded-full",
				selected ? "ob:bg-accent" : "ob:border ob:border-muted ob:bg-surface ob:shadow-xs",
				focusVisible && "ob:ring-2 ob:ring-accent ob:ring-offset-2",
				className,
			)}
		>
			<span className={cx("ob:size-1.5 ob:rounded-full ob:bg-accent-ink", selected ? "ob:scale-100 ob:opacity-100" : "ob:scale-0 ob:opacity-0")} />
		</span>
	);
}

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children"> {
	children?: ReactNode;
	ref?: Ref<HTMLDivElement>;
}

export function RadioGroup({ className, children, ref, ...props }: RadioGroupProps) {
	return (
		<AriaRadioGroup
			ref={ref}
			{...props}
			className={(state) => cx("ob:flex ob:flex-col ob:gap-2", typeof className === "function" ? className(state) : className)}
		>
			{children}
		</AriaRadioGroup>
	);
}

export interface RadioProps extends Omit<AriaRadioProps, "children"> {
	children?: ReactNode;
	ref?: Ref<HTMLLabelElement>;
}

export function Radio({ className, children, ref, ...props }: RadioProps) {
	return (
		<AriaRadio
			ref={ref}
			{...props}
			className={(state) =>
				cx(
					"ob:group ob:inline-flex ob:items-center ob:gap-2 ob:select-none",
					state.isDisabled ? "ob:cursor-not-allowed ob:opacity-50" : "ob:cursor-pointer",
					typeof className === "function" ? className(state) : className,
				)
			}
		>
			{(state) => (
				<>
					<RadioDot selected={state.isSelected} focusVisible={state.isFocusVisible} />
					{children !== undefined && children !== null ? <span className="ob:text-body-medium ob:text-text-primary">{children}</span> : null}
				</>
			)}
		</AriaRadio>
	);
}
