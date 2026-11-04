import type { ReactNode } from "react";

/** One question and its options. Approval cards and scope questions share this shape. */
export function ChoiceCard({
	label,
	className = "",
	marker,
	kicker,
	question,
	meta,
	children,
	options,
}: {
	readonly label: string;
	readonly className?: string;
	readonly marker?: string;
	readonly kicker?: ReactNode;
	readonly question: ReactNode;
	readonly meta?: ReactNode;
	readonly children?: ReactNode;
	readonly options?: ReactNode;
}) {
	return (
		<div className={`choice-card ${className}`.trim()} role="group" aria-label={label} {...(marker ? { "data-approval-id": marker } : {})}>
			{kicker ? <div className="choice-kicker">{kicker}</div> : null}
			<div className="choice-question">{question}</div>
			{meta ? <div className="choice-meta">{meta}</div> : null}
			{children}
			{options ? <div className="choice-options">{options}</div> : null}
		</div>
	);
}
