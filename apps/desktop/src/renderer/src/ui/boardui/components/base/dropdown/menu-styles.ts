export const MENU_POPOVER_SURFACE = [
	"ob:max-w-[calc(100vw-32px)] ob:overflow-y-auto",
	"ob:rounded-2xl ob:border ob:border-muted ob:bg-surface-raised ob:p-2.5 ob:shadow-dropdown",
	"ob:transition ob:duration-150 ob:ease-out",
	"ob:data-[entering]:opacity-0 ob:data-[entering]:scale-95",
	"ob:data-[exiting]:opacity-0 ob:data-[exiting]:scale-95",
	"ob:data-[placement=bottom]:origin-top-left ob:data-[placement=top]:origin-bottom-left",
].join(" ");

export const MENU_POPOVER_WIDTH = "ob:w-[266px] ob:max-w-full";

export const MENU_ITEMS_CONTAINER = "ob:flex ob:w-full ob:flex-col ob:gap-1 ob:outline-none";

export const MENU_ITEM = [
	"ob:flex ob:w-full ob:cursor-pointer ob:items-center ob:gap-2 ob:rounded-2lg ob:p-2 ob:text-start",
	"ob:text-body-medium ob:text-text-primary ob:outline-none",
].join(" ");

export const MENU_ITEM_ACTIVE = "ob:bg-surface";
