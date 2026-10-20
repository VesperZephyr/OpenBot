/** Deterministic report calculation; the Bot chooses and receives approval for its execution. */
import { readFile, writeFile } from "node:fs/promises";
const accounts = JSON.parse(await readFile("crm-snapshot.json", "utf8")).accounts;
const policy = await readFile("policy-capture.md", "utf8");
if (!policy.includes("more than 30 days")) throw Error("Policy source is missing or changed");
const rows = (await readFile("invoices.csv", "utf8")).trim().split("\n").slice(1).map(line => {
  const [id, amount, days] = line.split(",");
  if (!accounts.some(a => a.id === id) || !Number.isFinite(+amount) || !Number.isFinite(+days)) throw Error("Invalid invoice");
  return { id, amount: +amount, days: +days };
});
const overdue = rows.filter(r => r.days > 30);
const summary = { total: rows.reduce((n, r) => n + r.amount, 0), overdue: overdue.reduce((n, r) => n + r.amount, 0), proposed: accounts.filter(a => overdue.some(r => r.id === a.id) && a.risk !== "high").map(a => ({ accountId: a.id, expectedVersion: a.version, risk: "high" })) };
await writeFile("receivables.json", JSON.stringify(summary, null, 2));
await writeFile("receivables.md", `# Receivables review\n\nTotal: **$${summary.total}** · Overdue: **$${summary.overdue}**\n\nSource: invoices.csv and policy-capture.md (synthetic captured page).\n\n## Proposed changes\n\n${summary.proposed.map(p => `- ${p.accountId}: high risk (record version ${p.expectedVersion}); exact approval required.`).join("\n") || "No changes required."}\n\nNo CRM update is confirmed by this report. Check the separate execution receipt.\n`);
console.log(JSON.stringify(summary));
