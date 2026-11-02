import { useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
	Button as AriaButton,
	Label as AriaLabel,
	ListBox as AriaListBox,
	ListBoxItem as AriaListBoxItem,
	Popover as AriaPopover,
	Select as AriaSelect,
	SelectValue as AriaSelectValue,
} from "react-aria-components";
import type { Key, ListBoxItemProps as AriaListBoxItemProps, SelectProps as AriaSelectProps } from "react-aria-components";
import { InterfaceIcon } from "../../../../../InterfaceIcon";
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from "../dropdown/menu-styles";
import { cx } from "../../../utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "../../../utils/use-dismiss-on-outside-press";

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, "children" | "onSelectionChange"> {
	className?: string;
	triggerClassName?: string;
	popoverClassName?: string;
	label?: ReactNode;
	children: ReactNode;
	items?: Iterable<T>;
	onSelectionChange?: (key: Key | null) => void;
	ref?: Ref<HTMLDivElement>;
}

export function Select<T extends object>({
	className,
	triggerClassName,
	popoverClassName,
	label,
	children,
	items,
	ref,
	onSelectionChange,
	...props
}: SelectProps<T>) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef]);
	const allowOpenChange = useTriggerToggle(isOpen, triggerRef);
	const listProps = items === undefined ? {} : { items };
	const selectionProps = onSelectionChange === undefined ? {} : { onSelectionChange };
	return (
		<AriaSelect
			ref={ref}
			{...props}
			{...selectionProps}
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (allowOpenChange(open)) setIsOpen(open);
			}}
			data-openbot-ui=""
			className={cx("ob:group ob:flex ob:w-full ob:flex-col ob:gap-1.5", className)}
		>
			{label !== undefined && label !== null ? <AriaLabel className="ob:text-body-medium ob:text-text-primary">{label}</AriaLabel> : null}
			<AriaButton
				ref={triggerRef}
				className={cx(
					"ob:flex ob:min-h-9 ob:w-full ob:cursor-pointer ob:items-center ob:justify-between ob:gap-1.5 ob:rounded-2lg",
					"ob:border ob:border-muted ob:bg-surface ob:px-2.5 ob:py-2 ob:text-body-medium ob:text-text-primary ob:shadow-xs",
					"ob:hover:bg-surface-raised",
					"ob:outline-none ob:focus-visible:ring-2 ob:focus-visible:ring-offset-2 ob:focus-visible:ring-accent",
					"ob:disabled:cursor-not-allowed ob:disabled:opacity-45",
					triggerClassName,
				)}
			>
				<AriaSelectValue className="ob:flex ob:min-w-0 ob:items-center ob:truncate" />
				<span className={cx("ob:inline-flex ob:shrink-0 ob:text-text-secondary", isOpen && "ob:rotate-180")}>
					<InterfaceIcon name="chevronDown" size={16} />
				</span>
			</AriaButton>
			<AriaPopover
				ref={popoverRef}
				isNonModal
				offset={4}
				data-openbot-ui=""
				className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, "ob:p-2", popoverClassName)}
			>
				<AriaListBox {...listProps} className={cx(MENU_ITEMS_CONTAINER, "ob:max-h-60 ob:overflow-auto")}>
					{children}
				</AriaListBox>
			</AriaPopover>
		</AriaSelect>
	);
}

export interface SelectItemProps extends Omit<AriaListBoxItemProps, "children"> {
	children?: ReactNode;
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
	return (
		<AriaListBoxItem
			{...props}
			className={(state) =>
				cx(
					MENU_ITEM,
					(state.isFocused || state.isSelected) && MENU_ITEM_ACTIVE,
					state.isDisabled && "ob:cursor-not-allowed ob:opacity-45",
					typeof className === "function" ? className(state) : className,
				)
			}
		>
			{children}
		</AriaListBoxItem>
	);
}
