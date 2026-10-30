import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness;
const poll = (fn: () => Promise<any>) => expect.poll(fn, {timeout:15000});
const search = () => h.page().getByRole("searchbox");
const results = () => h.page().locator(".search-result");
const box = () => h.page().locator(".compose-area textarea");
/** Proves a read receipt was withheld: `useReadReceipt` acknowledges after 400 ms of readable dwell. */
const outlastReadDwell = () => h.page().waitForTimeout(650);
/** Counts of delayed "Archive batch" searches the intercepted main handler has started and answered. */
const delayed = (): Promise<{ started: number; answered: number }> => h.app().evaluate(() => (globalThis as any).delayedSearches);
const row = (name: string) => h.page().locator(".bot-row").filter({has:h.page().getByText(name,{exact:true})});
const unread = async (key: string) => (await h.api("conversations.list")).find((r:any)=>r.conversationKey===key).unreadCount;
const send = async (requestId: string, text: string) => {
	h.model.script({text});
	await h.api("messages.submit",{botId:"bot_analyst",requestId,text:`Request ${requestId}`});
	await poll(async () => (await h.api("conversations.list")).find((r:any)=>r.conversationKey==="bot:bot_analyst").latest?.text).toBe(text.replace(/\s+/g," ").slice(0,160));
	await poll(async () => (await h.api("bots.list")).find((b:any)=>b.botId==="bot_analyst").lastRun?.state).toBe("completed");
};
const foreground = async (active: boolean) => {
	await h.app().evaluate(({BrowserWindow}, value) => {
		const w=BrowserWindow.getAllWindows()[0]!;
		if(w.isVisible() || w.isFocusable()) throw Error("Keep the desktop hidden");
		w.webContents.send("openbot:window-active",value);
	},active);
	await h.page().evaluate((value)=>{
		Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>value});
		Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>value?"visible":"hidden"});
		document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event(value?"focus":"blur"));
	},active);
};
beforeAll(async()=>{
	h=await launchApp("conversation-search");h.page().setDefaultTimeout(10000);
	await h.api("settings.update",{defaultModel:{provider:"scripted",modelId:"scripted"}});
	for(const name of ["Analyst","Reviewer"]) await h.api("bots.create",{requestId:name.toLowerCase(),name,role:"Research"});
	await h.api("groups.change",{requestId:"create",action:"create",groupId:"group_search",expectedRevision:0,fields:{name:"Research studio",objective:"Search acceptance",memberIds:["bot_analyst","bot_reviewer"],leadBotId:"bot_analyst"}});
});
afterEach(async({task})=>{if(task.result?.state==="fail")await h.shot("failure");});
afterAll(async()=>{await h?.close();});

it("finds earlier private text, jumps exactly and preserves drafts/unread while viewing a search result",async()=>{
	await send("old","CEDAR_NEEDLE archived evidence.");
	await send("latest",Array.from({length:45},(_,i)=>`Latest finding ${i+1}: unrelated details.`).join("\n\n"));
	await row("Analyst").click();await box().fill("Keep my private draft");
	const calls=h.model.requests.length;
	await h.page().keyboard.press("Meta+k");
	expect(await search().evaluate(el=>el===document.activeElement)).toBe(true);
	await search().fill("cedar_needle");
	await poll(()=>results().count()).toBe(1);
	expect(await results().locator("mark").textContent()).toBe("CEDAR_NEEDLE");
	await results().first().focus();await h.page().keyboard.press("Enter");
	await h.page().getByText("Viewing a search result",{exact:true}).waitFor();
	await poll(()=>h.page().locator(".search-target").textContent()).toContain("CEDAR_NEEDLE");
	expect(await box().inputValue()).toBe("Keep my private draft");
	await foreground(true);await box().focus();await outlastReadDwell();
	expect(await unread("bot:bot_analyst")).toBe(2);
	await results().first().click();
	expect(await h.page().locator(".search-target").count()).toBe(1);
	await h.shot("01-private-search-en");
	await h.page().getByRole("button",{name:/Jump to latest/}).click();
	await poll(()=>unread("bot:bot_analyst")).toBe(0);
	expect(h.model.requests.length).toBe(calls);
	await foreground(false);
	await search().fill("");
});

it("combines unread filtering with group/private history and preserves selected drafts",async()=>{
	h.model.script({text:"群内星图已经核对。"});
	await h.api("groups.send",{groupId:"group_search",requestId:"group-answer",text:"请核对",recipientIds:["bot_reviewer"]});
	await poll(()=>unread("group:group_search")).toBe(1);
	await h.page().getByRole("group",{name:"Conversation filter"}).getByRole("button",{name:"Unread",exact:true}).click();
	// The Host projection can be ahead of the renderer's bounded observation refresh.
	await poll(()=>row("Analyst").count()).toBe(0);
	await poll(()=>row("Research studio").count()).toBe(1);
	expect(await box().inputValue()).toBe("Keep my private draft");
	await search().fill("cedar_needle");
	await h.page().getByText("No matching messages in unread conversations",{exact:true}).waitFor();
	await search().fill("群内星图");await poll(()=>results().count()).toBe(1);
	await results().click();await poll(()=>h.page().locator(".search-target").textContent()).toContain("群内星图");
	await box().fill("群聊草稿");
	await h.page().getByRole("button",{name:"Mark as read",exact:true}).click();
	await poll(()=>results().count()).toBe(0);
	await h.page().getByRole("group",{name:"Conversation filter"}).getByRole("button",{name:"All",exact:true}).click();
	await poll(()=>results().count()).toBe(1);
	expect(await box().inputValue()).toBe("群聊草稿");
	await search().press("Escape");expect(await search().inputValue()).toBe("");
});

it("rebuilds historical search after restart and handles Chinese, IME and a small dark window",async()=>{
	const before=await h.api("conversations.search",{query:"群内星图",includeHidden:true});
	await h.api("settings.update",{language:"zh-CN"});await h.relaunch();
	await h.page().keyboard.press("Meta+k");
	expect(await h.api("conversations.search",{query:"群内星图",includeHidden:true})).toEqual(before);
	await search().fill("群内星图");await poll(()=>results().count()).toBe(1);
	await search().dispatchEvent("keydown",{key:"Escape",isComposing:true});expect(await search().inputValue()).toBe("群内星图");
	await results().click();await h.page().getByText("正在查看搜索结果",{exact:true}).waitFor();
	expect(await box().inputValue()).toBe("群聊草稿");
	await h.app().evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(880,700));
	await h.page().emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});
	await h.shot("02-chinese-group-search-small");
	expect(await h.page().evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
	await h.page().getByRole("button",{name:"清除搜索",exact:true}).click();
	expect(await search().inputValue()).toBe("");
});

it("pages message matches and ignores old results after query changes",async()=>{
	for(let i=1;i<=34;i++)await send(`batch-${i}`,`Archive batch result ${i}.`);
	await search().fill("Archive batch");await poll(()=>results().count()).toBe(30);
	await h.page().getByRole("button",{name:"加载更多消息",exact:true}).click();await poll(()=>results().count()).toBe(34);
	await search().fill("does not exist");await h.page().getByText("没有匹配的消息",{exact:true}).waitFor();
	expect(await results().count()).toBe(0);
	await search().fill("cedar_needle");await poll(()=>results().count()).toBe(1);
	await h.shot("03-history-search-zh");
});

it("ignores delayed pages and recovers a search error without leaking query content",async()=>{
	await h.app().evaluate(({ipcMain})=>{
		const state=globalThis as any;
		state.searchOriginal=(ipcMain as any)._invokeHandlers.get("openbot:call");
		state.searchFault=false;
		state.delayedSearches={started:0,answered:0};
		ipcMain.removeHandler("openbot:call");
		ipcMain.handle("openbot:call",async(event,method,params)=>{
			if(method==="conversations.search" && state.searchFault){state.searchFault=false;throw Error("Synthetic search failure");}
			const slow=method==="conversations.search" && params.query==="Archive batch";
			if(slow)state.delayedSearches.started++;
			const result=await state.searchOriginal(event,method,params);
			if(slow){await new Promise(resolve=>setTimeout(resolve,900));state.delayedSearches.answered++;}
			return result;
		});
	});
	try {
		await search().fill("Archive batch");
		await h.page().getByText("正在搜索消息…",{exact:true}).waitFor();
		await poll(async()=>(await delayed()).started).toBe(1);
		await search().fill("群内星图");await poll(()=>results().count()).toBe(1);
		// The stale first page arrives after the newer query rendered; let React apply it before checking.
		await poll(async()=>(await delayed()).answered).toBe(1);await h.nextFrame();
		expect(await results().textContent()).toContain("群内星图");
		await search().fill("Archive batch");await poll(()=>results().count()).toBe(30);
		const pages=(await delayed()).started;
		await h.page().getByRole("button",{name:"加载更多消息",exact:true}).click();
		await poll(async()=>(await delayed()).started).toBe(pages+1);
		await search().fill("群内星图");await poll(()=>results().count()).toBe(1);
		await poll(async()=>(await delayed()).answered).toBe(pages+1);await h.nextFrame();
		expect(await results().count()).toBe(1);
		await search().fill("");
		await h.app().evaluate(()=>{(globalThis as any).searchFault=true;});
		await search().fill("群内星图");await h.page().getByText("无法搜索消息",{exact:false}).waitFor();
		expect(await h.page().getByText("Synthetic search failure",{exact:false}).count()).toBe(0);
		await h.page().locator(".search-results").getByRole("button",{name:"重试",exact:true}).click();
		await poll(()=>results().count()).toBe(1);
	} finally {
		await h.app().evaluate(({ipcMain})=>{ipcMain.removeHandler("openbot:call");ipcMain.handle("openbot:call",(globalThis as any).searchOriginal);});
	}
	await search().fill("cedar_needle");await poll(()=>results().count()).toBe(1);
});

it("keeps hidden history discoverable, excludes deleted Bots and retains dissolved group history",async()=>{
	await h.api("bots.update",{botId:"bot_analyst",status:"hidden"});
	await poll(()=>results().textContent()).toContain("已隐藏的 Bot");
	await h.api("bots.delete",{botId:"bot_analyst"});await poll(()=>results().count()).toBe(0);
	const group=(await h.api("groups.list")).find((g:any)=>g.groupId==="group_search");
	await h.api("groups.change",{requestId:"dissolve",action:"dissolve",groupId:group.groupId,expectedRevision:group.revision});
	await search().fill("群内星图");await poll(()=>results().count()).toBe(1);await results().click();
	await h.page().getByText("此群组已解散。历史记录只读，保存在此 Mac 上。",{exact:true}).waitFor();
	expect(await h.page().locator(".search-target").textContent()).toContain("群内星图");
	await h.shot("04-dissolved-search-zh");
});
