// A deterministic local command for the MVP acceptance workflow, run only in an isolated test workspace.
import { appendFile, readFile, writeFile } from "node:fs/promises";
const rows = (await readFile("weekly-sales.csv", "utf8")).trim().split("\n").slice(1).map(line => line.split(","));
const weeks = {};
for (const [week, product, amount] of rows) {
  weeks[week] ??= {};
  weeks[week][product] = (weeks[week][product] ?? 0) + Number(amount);
}
const totals = Object.fromEntries(Object.entries(weeks).map(([week, products]) => [week, Object.values(products).reduce((a, b) => a + b, 0)]));
const products = Object.keys(weeks["2026-10-12"]).map(product => ({
  product, previous: weeks["2026-10-05"][product], current: weeks["2026-10-12"][product],
  change: weeks["2026-10-12"][product] - weeks["2026-10-05"][product],
}));
const summary = { rows: rows.length, totals, products, growthPercent: (totals["2026-10-12"] / totals["2026-10-05"] - 1) * 100 };
await writeFile("reports/summary.json", JSON.stringify(summary, null, 2));
await writeFile("reports/weekly-summary.csv", "product,previous_usd,current_usd,change_usd\n" + products.map(p => [p.product, p.previous, p.current, p.change].join(",")).join("\n") + "\n");
await appendFile("calculation-runs.txt", "calculated\n");
console.log(JSON.stringify(summary));
