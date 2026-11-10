import type { SkillChange, SkillDocument } from "@openbot/protocol";
import { t } from "../i18n";

export const labels: Record<keyof SkillDocument, string> = {
	name: "Skill name",
	description: "When to use",
	inputs: "Inputs",
	requirements: "Requirements",
	steps: "Steps",
	validation: "Validation",
	output: "Output",
	approvalBoundaries: "Approval boundaries",
};

export function SkillReview({ change, currentRevision }: { change: SkillChange; currentRevision?: number }) {
	return (
		<section className="skill-review" aria-label={t("Review skill")}>
			<header>
				<strong>/{change.name}</strong>
				<span className="skill-version">
					{currentRevision === undefined ? (
						<>
							{t("Version {revision}", { revision: change.expectedRevision })} → {change.expectedRevision + 1}
						</>
					) : (
						t("Version {revision}", { revision: currentRevision })
					)}
				</span>
			</header>
			{change.action === "delete" ? (
				<p>{t("Delete this shared skill? Accepted messages keep their selected version.")}</p>
			) : (
				Object.entries(labels)
					.filter(([key]) => key !== "name")
					.map(([key, label]) => (
						<div className="skill-section" key={key}>
							<h3>{t(label)}</h3>
							<p>{change.document[key as keyof SkillDocument]}</p>
						</div>
					))
			)}
			<p className="muted">{t("Skills guide every Bot. Tool permissions still apply.")}</p>
		</section>
	);
}
