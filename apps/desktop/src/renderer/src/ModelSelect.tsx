import type { ModelRef, ModelSummary } from "@openbot/protocol";
import { t } from "./i18n";
import { visibleModelOptions } from "./model-options";
import { useStore } from "./store";

export function ModelSelect(props: {
	readonly value: ModelRef | undefined;
	readonly onChange: (model: ModelRef | undefined) => void;
	readonly emptyLabel: string;
}) {
	const models = useStore((state) => state.models);
	const settings = useStore((state) => state.settings);
	const byProvider = new Map<string, ModelSummary[]>();
	for (const model of visibleModelOptions(models, settings?.providers)) {
		byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
	}
	const groups = [...byProvider];
	const selected = props.value === undefined ? "" : `${props.value.provider}/${props.value.modelId}`;
	const commit = (value: string): void => {
		if (value === selected) return;
		const separator = value.indexOf("/");
		props.onChange(separator < 0 ? undefined : { provider: value.slice(0, separator), modelId: value.slice(separator + 1) });
	};

	return (
		<select
			value={selected}
			onChange={(event) => commit(event.target.value)}
			onInput={(event) => commit((event.target as HTMLSelectElement).value)}
		>
			<option value="">{t(props.emptyLabel)}</option>
			{/* Keep a stored model selectable even when its provider key was removed. */}
			{props.value !== undefined && !groups.some(([, list]) => list.some((model) => `${model.provider}/${model.modelId}` === selected)) && (
				<option value={selected}>
					{selected}
					{t(" · Unavailable")}
				</option>
			)}
			{groups.map(([provider, list]) => (
				<optgroup
					key={provider}
					label={`${provider} · ${t(list[0]?.source === "custom" ? "Custom" : "Built-in")}${list[0]?.overridden ? t(" · Local override") : ""}`}
				>
					{list.map((model) => (
						<option key={model.modelId} value={`${model.provider}/${model.modelId}`}>
							{model.name}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);
}
