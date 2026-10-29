import { basename } from "node:path";
import { parseTemplateJson, TEMPLATE_LIMITS, type TemplateFile } from "@openbot/protocol";
import { bytesAt, selectedPath } from "./artifacts.ts";
import { validateAvatar } from "./avatars.ts";
export function readBotTemplate(path: string): TemplateFile {
	try {
		const bytes = bytesAt(selectedPath(path), TEMPLATE_LIMITS.fileBytes);
		const template = parseTemplateJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		if (template.profile.avatar.kind === "png") validateAvatar(template.profile.avatar.base64);
		return {
			name: Array.from(basename(path).replace(/[\u0000-\u001f\u007f]/g, ""))
				.slice(0, 200)
				.join(""),
			template,
		};
	} catch {
		throw new Error("Could not read this Bot template. Choose a valid template file up to 1 MiB.");
	}
}
