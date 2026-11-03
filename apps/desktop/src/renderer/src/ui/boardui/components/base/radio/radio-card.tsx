import type { ReactNode, Ref } from "react";
import { Radio as AriaRadio } from "react-aria-components";
import type { RadioProps as AriaRadioProps } from "react-aria-components";
import { cx } from "../../../utils/cx";
import { RadioDot } from "./radio";

export interface RadioCardProps extends Omit<AriaRadioProps, "children"> {
	title: ReactNode;
	description?: ReactNode;
	preview?: ReactNode;
	ref?: Ref<HTMLLabelElement>;
}

export function RadioCard({ className, title, description, preview, ref, ...props }: RadioCardProps) {
	return (
		<AriaRadio
			ref={ref}
			{...props}
			className={(state) =>
				cx(
					"ob:group ob:flex ob:w-full ob:min-w-0 ob:cursor-pointer ob:flex-col ob:gap-1 ob:rounded-2lg ob:border ob:border-muted ob:bg-surface ob:p-2 ob:select-none",
					state.isHovered && !state.isDisabled && "ob:bg-surface-raised",
					state.isSelected && "ob:border-accent ob:ring-1 ob:ring-accent",
					state.isFocusVisible && "ob:outline-2 ob:outline-offset-2 ob:outline-accent",
					state.isDisabled && "ob:cursor-not-allowed ob:opacity-50",
					typeof className === "function" ? className(state) : className,
				)
			}
		>
			{(state) => (
				<>
					{preview}
					<span className="ob:flex ob:min-w-0 ob:items-center ob:justify-between ob:gap-1 ob:whitespace-normal">
						<span className="ob:min-w-0 ob:whitespace-normal ob:text-body-2-medium ob:text-text-primary">{title}</span>
						<RadioDot selected={state.isSelected} focusVisible={state.isFocusVisible} />
					</span>
					{description !== undefined && description !== null ? (
						<span className="ob:whitespace-normal ob:text-body-regular ob:text-text-secondary">{description}</span>
					) : null}
				</>
			)}
		</AriaRadio>
	);
}
