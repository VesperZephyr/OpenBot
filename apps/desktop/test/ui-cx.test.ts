import { expect, it } from "vitest";
import { cx } from "../src/renderer/src/ui/boardui/utils/cx.ts";

it("keeps prefixed typography and color together and resolves spacing conflicts", () => {
	const merged = cx("ob:text-body-medium ob:text-text-primary ob:p-2 ob:p-4");
	expect(merged).toContain("ob:text-body-medium");
	expect(merged).toContain("ob:text-text-primary");
	expect(merged).toBe("ob:text-body-medium ob:text-text-primary ob:p-4");
	expect(cx("ob:text-text-primary ob:text-text-secondary")).toBe("ob:text-text-secondary");
});
