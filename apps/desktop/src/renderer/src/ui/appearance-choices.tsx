import { useId } from "react";
import { RadioCard } from "./boardui/components/base/radio/radio-card";
import { RadioGroup } from "./boardui/components/base/radio/radio";

export function AppearanceChoices({
	legend,
	value,
	onChange,
	options,
}: {
	legend: string;
	value: "light" | "dark" | "system";
	onChange: (value: "light" | "dark" | "system") => void;
	options: readonly { value: "light" | "dark" | "system"; label: string }[];
}) {
	const legendId = useId();
	return (
		<fieldset className="appearance-setting" data-openbot-ui="">
			<legend id={legendId}>{legend}</legend>
			<RadioGroup
				aria-labelledby={legendId}
				orientation="horizontal"
				value={value}
				onChange={(next) => {
					if (next === "light" || next === "dark" || next === "system") onChange(next);
				}}
				className="appearance-choices ob:grid ob:grid-cols-3 ob:gap-3"
			>
				{options.map((option) => (
					<RadioCard
						key={option.value}
						className="appearance-choice"
						value={option.value}
						title={<span className="appearance-label">{option.label}</span>}
						preview={
							<span className={`appearance-preview preview-${option.value}`} aria-hidden="true">
								<i />
								<span>
									<b />
									<b />
									<em />
								</span>
							</span>
						}
					/>
				))}
			</RadioGroup>
		</fieldset>
	);
}
