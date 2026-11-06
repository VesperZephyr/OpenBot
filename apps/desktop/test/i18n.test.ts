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
it("translates settings empty states, the model file sentence, and approval copy", () => {
 expect(translate("en", "Add an API key below first")).toBe("Add an API key below first");
 expect(translate("zh-CN", "Add an API key below first")).toBe("请先在下方添加 API 密钥");
 expect(translate("en", "Choose a model")).toBe("Choose a model");
 expect(translate("zh-CN", "Choose a model")).toBe("选择模型");
 expect(translate("zh-CN", "Add OpenAI- or Anthropic-compatible endpoints in ")).toBe("可在以下文件中添加兼容 OpenAI 或 Anthropic 的端点： ");
 expect(translate("zh-CN", ". Changes apply when you open Settings or choose a model.")).toBe("。打开设置或选择模型时会加载更新。");
 expect(translate("zh-CN", "Key from models.json")).toBe("来自 models.json 的密钥");
 expect(translate("zh-CN", "Approval request")).toBe("授权请求");
 expect(translate("en", "Approval record")).toBe("Approval record");
 expect(translate("zh-CN", "Approval record")).toBe("授权记录");
 expect(translate("en", "Loading")).toBe("Loading");
 expect(translate("zh-CN", "Loading")).toBe("加载中");
 expect(translate("en", "Submitting")).toBe("Submitting");
 expect(translate("zh-CN", "Submitting")).toBe("提交中");
});
