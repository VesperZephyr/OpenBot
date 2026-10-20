/** Synthetic business service: its effect ledger is independent of OpenBot receipts. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { httpsFixture } from "../../packages/local-executor/test/fixtures/mcp-https.ts";
export const referenceUrl = "https://policy.example.org/receivables";
export const policyCapture = `# Receivables policy (synthetic captured source)\nSource: ${referenceUrl}\nAccounts with invoices more than 30 days overdue require a high risk flag. Verify record versions and review every proposed CRM change. Search snippets are not the full source.\n`;
export const initialInvoices = "account_id,amount_usd,days_overdue\natlas,1200,60\nboreal,800,12\n";
export const changedInvoices = "account_id,amount_usd,days_overdue\natlas,1500,60\nboreal,1000,45\n";
export async function crmFixture(root: string) {
	const accounts = [
		{ id: "atlas", name: "Atlas Studio", version: 1, risk: "normal" },
		{ id: "boreal", name: "Boreal Labs", version: 1, risk: "normal" },
	];
	const effects: { accountId: string; expectedVersion: number; risk: string }[] = [];
	const calls: string[] = [];
	let loseNextResponse = false;
	const content = (value: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
	const transport = await httpsFixture(root, {
		tools: [
			{ name: "list_accounts", description: "Read current synthetic CRM accounts and record versions", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
			{ name: "update_account", description: "Update one synthetic CRM risk flag after exact approval. Never retry an uncertain response.", inputSchema: {
				type: "object", properties: { accountId: { type: "string", enum: ["atlas", "boreal"] }, expectedVersion: { type: "integer", minimum: 1 }, risk: { type: "string", enum: ["normal", "high"] } }, required: ["accountId", "expectedVersion", "risk"], additionalProperties: false,
			} },
		],
		call(name, args) {
			calls.push(name);
			if (name === "list_accounts") return content({ accounts });
			if (name !== "update_account") return content({ error: "Unknown tool" }, true);
			const account = accounts.find(a => a.id === args.accountId);
			if (!account || account.version !== args.expectedVersion || !["normal", "high"].includes(String(args.risk))) return content({ error: "Record version conflict or invalid risk" }, true);
			effects.push({ accountId: account.id, expectedVersion: account.version, risk: String(args.risk) });
			account.risk = String(args.risk);
			account.version++;
			if (loseNextResponse) { loseNextResponse = false; return undefined; }
			return content({ updated: account });
		},
	});
	let searchRequests = 0;
	const search = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			searchRequests++;
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results: [{ title: "Receivables policy (synthetic)", url: referenceUrl, content: "Review overdue accounts. Read the complete captured policy before deciding.", score: 1 }] }));
		});
	});
	await new Promise<void>(resolve => search.listen(0, "127.0.0.1", resolve));
	return {
		...transport, accounts, effects, calls,
		get searchRequests() { return searchRequests; },
		loseNextResponse() { loseNextResponse = true; },
		searchUrl: `http://127.0.0.1:${(search.address() as AddressInfo).port}`,
		async close() { search.closeAllConnections(); await new Promise<void>(resolve => search.close(() => resolve())); await transport.close(); },
	};
}
