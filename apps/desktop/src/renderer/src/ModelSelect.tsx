import { useEffect } from "react";
import type { ModelRef, ModelSummary } from "@openbot/protocol";
import { t } from "./i18n";
import { modelCatalogPending, visibleModelOptions } from "./model-options";
import { refreshSettings, useStore } from "./store";

export function ModelSelect(props: {
	readonly value: ModelRef | undefined;
	readonly onChange: (model: ModelRef | undefined) => void;
	readonly emptyLabel: string;
}) {
	const models = useStore((state) => state.models);
	const settings = useStore((state) => state.settings);
	const pending = modelCatalogPending(models, settings);
	useEffect(() => {
		if (!pending) return;
		let active = true;
		let timer = 0;
		const load = (): void => {
			void refreshSettings()
				.catch(() => undefined)
				.finally(() => {
					if (!active) return;
					const state = useStore.getState();
					if (modelCatalogPending(state.models, state.settings)) timer = window.setTimeout(load, 300);
				});
		};
		load();
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [pending]);
	if (pending) return <span aria-busy="true" />;

	const byProvider = new Map<string, ModelSummary[]>();
	for (const model of visibleModelOptions(models, settings?.providers)) {
		byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
	}
	const groups = [...byProvider];
	const selected = props.value === undefined ? "" : `${props.value.provider}/${props.value.modelId}`;

	return (
		<select
			value={selected}
			onChange={(event) => {
				const separator = event.target.value.indexOf("/");
				props.onChange(
					separator < 0
						? undefined
						: { provider: event.target.value.slice(0, separator), modelId: event.target.value.slice(separator + 1) },
				);
			}}
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
