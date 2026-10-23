import type { SkillDocument } from "../../packages/protocol/src/index.ts";

export const invoices = [
	{ id: "A101", customer: "Atlas", amount: 1200, days: 21, status: "unpaid" },
	{ id: "A102", customer: "Boreal", amount: 800, days: 10, status: "unpaid" },
	{ id: "A103", customer: "Cedar", amount: 600, days: 16, status: "unpaid" },
	{ id: "A104", customer: "Atlas", amount: 200, days: 22, status: "paid" },
	{ id: "A105", customer: "Delta", amount: 400, days: 30, status: "unpaid" },
	{ id: "A106", customer: "Echo", amount: 500, days: 14, status: "unpaid" },
] as const;
export const invoiceCsv = "invoice_id,customer,amount_usd,days_overdue,status\n" + invoices.map(row => [row.id, row.customer, row.amount, row.days, row.status].join(",")).join("\n") + "\n";

/** Independent expected values; these are never placed in the model's workspace. */
export function expectedReport(cutoff: number) {
	const unpaid = invoices.filter(row => row.status === "unpaid");
	const overdue = unpaid.filter(row => row.days > cutoff);
	return { cutoff_days: cutoff, currency: "USD", unpaid_total: unpaid.reduce((sum, row) => sum + row.amount, 0), overdue_total: overdue.reduce((sum, row) => sum + row.amount, 0), overdue_invoice_ids: overdue.map(row => row.id).sort() };
}

const boundaries = "Use file tools in the supplied synthetic workspace only. No terminal commands, network calls, external messages or changes to source invoices. A skill never grants additional permission.";
export const triageSkill = (version = 1): SkillDocument => ({
	name: "collections-triage", description: "Reconcile unpaid invoices using the current remembered collection policy and produce an auditable report.",
	inputs: "invoices.csv, the current collection policy from memory or an explicit current task instruction, and an output basename supplied by the user.",
	requirements: "Read/write access to the synthetic workspace. If the policy is missing, ask rather than guess.",
	steps: `Read the actual CSV. Exclude paid invoices. Overdue means days_overdue strictly greater than the current cutoff; the boundary itself is excluded. Sum all unpaid amounts and the overdue subset. Write <basename>.json with cutoff_days, currency, unpaid_total, overdue_total, overdue_invoice_ids (sorted), and method_revision='triage-v${version}'. Write <basename>.md with the totals, included invoice IDs, policy and a short action list. Publish the Markdown result. Use local_read/local_write; no commands are needed for six rows.`,
	validation: "Recheck every row, especially paid invoices and the exact cutoff boundary. Do not infer totals from an old report. Read the output back before reporting completion.",
	output: "An actual JSON file and published Markdown report, with verified numbers and any limitation.", approvalBoundaries: boundaries,
});
export const reviewSkill: SkillDocument = {
	name: "collections-review", description: "Independently validate a collections report against invoice rows and produce a decision brief.",
	inputs: "The user-specified source report JSON and invoices.csv; a destination basename.", requirements: "Local file access; read the source report's cutoff instead of assuming one.",
	steps: "Read both source files. Independently recompute unpaid and overdue totals and IDs using the report's cutoff. Write <basename>.json with passed (boolean), checked_overdue_total, source_report (filename), and method_revision='review-v1'. Write <basename>.md with a concise review, evidence filenames and next actions. Publish it. Do not rewrite the analyst's report. Use local file tools only.",
	validation: "A numerical mismatch must set passed=false and identify the problem. Check the paid row and exact cutoff boundary. Read back the review files.",
	output: "An independent JSON verdict and published Markdown decision brief.", approvalBoundaries: boundaries,
};
