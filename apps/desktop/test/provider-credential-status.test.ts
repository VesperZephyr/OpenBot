import { expect, it } from "vitest";
import { providerCredentialStatus } from "../src/renderer/src/features/settings/provider-credential-status";

const paragraph = ["可在以下文件中添加", "Add OpenAI- or Anthropic-compatible endpoints", "You can add"];

it("keeps a provider credential row to the short status", () => {
	expect(providerCredentialStatus(true, "en")).toBe("Key stored");
	expect(providerCredentialStatus(true, "zh-CN")).toBe("密钥已保存");
	expect(providerCredentialStatus(false, "en")).toBe("Key from models.json");
	expect(providerCredentialStatus(false, "zh-CN")).toBe("来自 models.json 的密钥");
	for (const language of ["en", "zh-CN"] as const) {
		for (const keyStored of [true, false]) {
			const status = providerCredentialStatus(keyStored, language);
			expect(status).not.toContain(" · models.json");
			for (const fragment of paragraph) expect(status).not.toContain(fragment);
		}
	}
});
