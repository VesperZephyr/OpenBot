import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkApprovalUiImports } from "../check-boundaries.mjs";

async function renderer(files: Record<string, string>) {
	const root = await mkdtemp(join(tmpdir(), "openbot-approval-boundary-"));
	for (const [name, text] of Object.entries(files)) {
		await mkdir(join(root, name, ".."), { recursive: true });
		await writeFile(join(root, name), text);
	}
	return root;
}

it("rejects approval UI imports of Skills, BotManagement, and GroupPreview", async () => {
	const root = await renderer({
		"ApprovalCard.tsx": 'import { SkillReview } from "./Skills";\nexport const card = SkillReview;\n',
		"AlwaysAllow.tsx": 'export { ManagementPreview } from "./BotManagement";\n',
		"approval-records.ts": 'export const load = () => import("./GroupPreview");\n',
		"composer-approval.ts": 'import { preview } from "./GroupPreview/index";\nexport const value = preview;\n',
		"Skills.tsx": "export const SkillReview = {};\n",
		"BotManagement.tsx": "export const ManagementPreview = {};\n",
		"GroupPreview.tsx": "export const GroupPreview = {};\n",
		"GroupPreview/index.ts": "export const preview = {};\n",
	});
	const errors = checkApprovalUiImports(root);
	expect(errors.join("\n")).toContain("ApprovalCard.tsx");
	expect(errors.join("\n")).toContain("./Skills");
	expect(errors.join("\n")).toContain("AlwaysAllow.tsx");
	expect(errors.join("\n")).toContain("./BotManagement");
	expect(errors.join("\n")).toContain("approval-records.ts");
	expect(errors.join("\n")).toContain("./GroupPreview");
	expect(errors.join("\n")).toContain("composer-approval.ts");
	expect(errors.join("\n")).toContain("move the shared preview into a neutral module or pass it from the caller");
});

it("rejects a neutral preview that reaches back into a feature module", async () => {
	const root = await renderer({
		"ApprovalCard.tsx": 'import { SkillReview } from "./previews/skill-review";\nexport const card = SkillReview;\n',
		"previews/skill-review.tsx": 'export { SkillReview } from "../Skills";\n',
		"Skills.tsx": "export const SkillReview = {};\n",
	});
	const errors = checkApprovalUiImports(root);
	expect(errors.join("\n")).toContain("previews/skill-review.tsx");
	expect(errors.join("\n")).toContain("../Skills");
});

it("allows approval UI to render neutral previews", async () => {
	const root = await renderer({
		"ApprovalCard.tsx":
			'import { SkillReview } from "./previews/skill-review";\nimport { ManagementPreview } from "./previews/management-preview";\nexport const card = { SkillReview, ManagementPreview };\n',
		"previews/skill-review.tsx": 'import { t } from "../i18n";\nexport const SkillReview = t;\n',
		"previews/management-preview.tsx": "export const ManagementPreview = {};\n",
		"i18n.ts": "export const t = () => \"\";\n",
	});
	expect(checkApprovalUiImports(root)).toEqual([]);
});

it("accepts the product approval UI", () => {
	const root = new URL("../..", import.meta.url);
	expect(checkApprovalUiImports(join(root.pathname, "apps/desktop/src/renderer/src"))).toEqual([]);
});
