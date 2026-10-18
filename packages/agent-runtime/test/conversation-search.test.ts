import { expect, it } from "vitest";
import { ConversationSearchIndex } from "../src/conversation-search.ts";
import { directMessages, groupMessages } from "../src/conversation-index.ts";
import type { ConversationPreview } from "@openbot/protocol";
const entry = (id: string, text: string, at = 1): ConversationPreview => ({ id, text, at, senderId: "a" });
const eligible = new Set(["bot:a", "group:g"]);
it("searches full old English/Chinese text literally and returns safe bounded highlighted excerpts", () => {
	const index = new ConversationSearchIndex();
	index.project("bot:a", [entry("old", "🦊".repeat(300) + " Check Report_Final.md [v2]. 中文检索结果\n下一行。", 1), entry("new", "Latest unrelated reply", 2)]);
	for (const query of ["report_final.md [v2]", "中文检索", "检", "结果 下一行"] ) {
		const [hit] = index.search(query, eligible, query).items;
		expect(hit?.messageId).toBe("old");
		expect(Array.from(hit!.snippet).length).toBeLessThanOrEqual(180);
		expect(hit!.snippet.slice(hit!.matchStart, hit!.matchEnd).toLowerCase()).toBe(query);
	}
	expect(index.search(".*", eligible, ".*").items).toEqual([]);
	expect(index.search("", eligible, "").items).toEqual([]);
});
it("keeps paging deterministic with tied timestamps, newly inserted messages and repeated projections", () => {
	const index = new ConversationSearchIndex();
	const messages = Array.from({ length: 75 }, (_, i) => entry(`m${String(i).padStart(3,"0")}`, "needle", 100));
	index.project("bot:a", messages);
	const first = index.search("needle", eligible, "needle");
	expect(first.items).toHaveLength(30);
	index.project("bot:a", messages);
	index.project("bot:a", messages.slice(0, 3));
	index.project("bot:a", [...messages, entry("new", "needle", 200)]);
	const second = index.search("needle", eligible, "needle", first.nextCursor);
	const third = index.search("needle", eligible, "needle", second.nextCursor);
	expect([...first.items, ...second.items, ...third.items].map((r) => r.messageId)).toEqual(messages.map((m) => m.id));
	expect(third.nextCursor).toBeUndefined();
	for (const cursor of ["junk", Buffer.from("null").toString("base64url"), "x".repeat(4097)])
		expect(() => index.search("needle", eligible, "needle", cursor)).toThrow("Invalid search cursor");
	expect(() => index.search("other", eligible, "other", first.nextCursor)).toThrow("Invalid search cursor");
	expect(index.search("needle", new Set(), "needle").items).toEqual([]);
});
it("excludes tools, reasoning, live fragments and group coordination receipts", () => {
	const index = new ConversationSearchIndex();
	index.project("bot:a", directMessages({ botId: "a", approvals: [], live: {state:"running",partial:[{type:"text",text:"private token"}]}, items: [
		{kind:"user",id:"u",parts:[{type:"text",text:"Visible input"}]},
		{kind:"assistant",id:"a",parts:[{type:"text",text:"Visible answer"}],thinking:"private thoughts"},
		{kind:"tool",id:"t",tool:"local_read",status:"succeeded",args:{},output:"private output"},
		{kind:"assistant",id:"error",parts:[],error:"private error"},
	] }));
	index.project("group:g", groupMessages([
		{postId:"handoff",senderId:"a",text:"private dispatch",kind:"handoff",at:1,recipientIds:["b"]},
		{postId:"result",senderId:"b",text:"Visible public result",kind:"result",at:2,recipientIds:[]},
	]));
	expect(index.search("private", eligible, "private").items).toEqual([]);
	expect(index.search("visible", eligible, "visible").items.map((h) => h.messageId)).toEqual(["result","a","u"]);
});
it("bounds pages across a 10,000-message corpus without loading or returning full histories", () => {
	const index = new ConversationSearchIndex();
	index.project("bot:a", Array.from({length:10000}, (_, i) => entry(String(i), "Earlier text ".repeat(40) + (i % 2 ? "历史命中" : "other"), i)));
	const start = performance.now();
	const result = index.search("历史命中", eligible, "large");
	expect(performance.now() - start).toBeLessThan(2000);
	expect(result.items).toHaveLength(30);
	expect(result.items[0]?.messageId).toBe("9999");
	expect(result.nextCursor).toBeDefined();
	expect(JSON.stringify(result).length).toBeLessThan(20000);
});

it("preserves original context formatting and pages by serialized bytes without losing hits", () => {
 const index = new ConversationSearchIndex();
 const text = "needle\n\t```js\nconst x = 1;\n```";
 index.project("group:g", [entry("context", text)]);
 expect(index.read("group:g")[0]?.text).toBe(text);
 expect(index.search("needle", eligible, "context").items[0]?.snippet).not.toContain("\n");
 const messages = Array.from({length:40}, (_,i)=>entry(`${String(i).padStart(3,"0")}${"x".repeat(1000)}`, "needle " + "🦊".repeat(200), 100));
 index.project("bot:a", messages);
 const ids:string[]=[]; let cursor:string|undefined;
 do {
  const page=index.search("needle",new Set(["bot:a"]),"scope",cursor);
  expect(Buffer.byteLength(JSON.stringify({ok:true,value:page}))).toBeLessThanOrEqual(32768);
  expect(page.items.length).toBeLessThan(30);
  ids.push(...page.items.map(m=>m.messageId));cursor=page.nextCursor;
 } while(cursor);
 expect(ids).toEqual(messages.map(m=>m.id));
});
