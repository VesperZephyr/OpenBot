import { Select, SelectItem } from "./boardui/components/base/select/select";

export function LanguageField({
	label,
	caption,
	value,
	onChange,
}: {
	label: string;
	caption: string;
	value: "en" | "zh-CN";
	onChange: (language: "en" | "zh-CN") => void;
}) {
	return (
		<div data-openbot-ui="" className="ob:flex ob:flex-col ob:gap-2">
			<Select
				label={label}
				selectedKey={value}
				onSelectionChange={(key) => {
					if ((key === "en" || key === "zh-CN") && key !== value) onChange(key);
				}}
			>
				<SelectItem id="en" textValue="English">
					English
				</SelectItem>
				<SelectItem id="zh-CN" textValue="简体中文">
					简体中文
				</SelectItem>
			</Select>
			<p className="model-caption ob:text-caption-1-semibold ob:font-normal ob:text-text-secondary">{caption}</p>
		</div>
	);
}
