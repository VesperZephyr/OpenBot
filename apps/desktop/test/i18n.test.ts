import { expect, it } from "vitest";
import { paramsError } from "@openbot/protocol/schemas";
import { translate } from "../src/shared/i18n";

it("accepts only the supported language preferences", () => {
 expect(paramsError("settings.update", { language: "en" })).toBeUndefined();
 expect(paramsError("settings.update", { language: "zh-CN" })).toBeUndefined();
 expect(paramsError("settings.update", { language: "fr" })).toBeDefined();
 expect(paramsError("settings.update", { language: null })).toBeDefined();
});
it("interpolates user content literally and leaves external diagnostics untouched", () => {
 expect(translate("en", "Message {name}", { name: "助手 $& {name}" })).toBe("Message 助手 $& {name}");
 expect(translate("zh-CN", "Message {name}", { name: "助手 $& {name}" })).toBe("发送消息给 助手 $& {name}");
 expect(translate("zh-CN", "external error: Cedar")).toBe("external error: Cedar");
 expect(translate("zh-CN", "Open OpenBot")).toBe("打开 OpenBot");
});
