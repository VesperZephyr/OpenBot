import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
import type { ModelRequest } from "./scripted-model.ts";
let h: AppHarness, core: string, privateHit: any;
const api=(name:string,params={}):Promise<any>=>h.page().evaluate(({name,params})=>(window as any).openbot.methods[name](params),{name,params});
const poll=(fn:()=>Promise<any>)=>expect.poll(fn,{timeout:15000});
const done=async(botId:string)=>{ for(let i=0;i<150;i++){if((await api("bots.list")).find((b:any)=>b.botId===botId).lastRun?.state==="completed")return;await new Promise(r=>setTimeout(r,100));}throw Error("Run did not complete"); };
const toolResults=(request:ModelRequest)=>request.messages.filter(m=>m.role==="tool").map(m=>{
	try{return JSON.parse(typeof m.content==="string"?m.content.split("Output:\n\n").at(-1)!:JSON.stringify(m.content));}catch{return {raw:m.content};}
});
const composed=(query:string)=>({tool:"codemode",args:{code:`const found=await tools.app_conversations_search({query:${JSON.stringify(query)},unreadOnly:true}); if(!found.ok) throw Error("Search failed"); const hit=found.value.items.find(i=>i.senderId!=="user"); if(!hit) throw Error("No hit"); const read=await tools.app_conversations_read({conversationKey:hit.conversationKey,anchorMessageId:hit.messageId,before:1,after:1}); text(read);`}});
const send=async(text:string)=>{const box=h.page().locator(".compose-area textarea");await box.fill(text);await box.press("Enter");};
const selectBot=async(name:string)=>h.page().locator(".bot-row").filter({has:h.page().getByText(name,{exact:true})}).click();
beforeAll(async()=>{
	h=await launchApp("app-capabilities");h.page().setDefaultTimeout(10000);
	await api("settings.update",{defaultModel:{provider:"scripted",modelId:"scripted"}});core=(await api("bots.list"))[0].botId;
	for(const name of ["Analyst","Reviewer","Outside"])await api("bots.create",{requestId:name.toLowerCase(),name,instructions:"PRIVATE_PROMPT_DO_NOT_RETRIEVE"});
	await api("bots.memory.update",{botId:"bot_analyst",expectedRevision:0,content:"PRIVATE_MEMORY_DO_NOT_RETRIEVE"});
	h.model.script({text:"ORBIT_B24 launch date: November 7. 星图已归档。"});
	await api("messages.submit",{botId:"bot_analyst",requestId:"source",text:"Keep this launch note."});await done("bot_analyst");
	privateHit=(await api("conversations.search",{query:"ORBIT_B24"})).items[0];
	await api("conversations.reset",{botId:"bot_analyst"});
	h.model.script({text:"Current topic has no launch date."});await api("messages.submit",{botId:"bot_analyst",requestId:"new",text:"Start another topic."});await done("bot_analyst");
});
afterEach(async({task})=>{if(task.result?.state==="fail")await h.shot("failure");});
afterAll(async()=>{await h?.close();});

it("Core searches retained private history and reads exact context with no read or memory side effects",async()=>{
	const before=(await api("conversations.list")).find((r:any)=>r.conversationKey==="bot:bot_analyst");
	const memory=await api("bots.memory.get",{botId:"bot_analyst"});
	const requestStart=h.model.requests.length;
	h.model.script(composed("ORBIT_B24"),{text:"The launch date is November 7, from Analyst's archived ORBIT_B24 message."});
	await send("Search my earlier chats for ORBIT_B24 and read the matching context.");await done(core);
	await h.page().getByText("The launch date is November 7, from Analyst's archived ORBIT_B24 message.",{exact:true}).waitFor();
	await h.page().getByText("Read application data",{exact:true}).click();
	await h.page().getByText("Searched chat history",{exact:true}).waitFor();await h.page().getByText("Read chat context",{exact:true}).waitFor();
	const outputs=toolResults(h.model.requests.at(-1)!);expect(outputs).toHaveLength(1);expect(h.model.requests.length-requestStart).toBe(2);expect(outputs.at(-1)?.ok).toBe(true);
	expect(outputs.at(-1)?.value.anchorMessageId).toBe(privateHit.messageId);
	expect(JSON.stringify(outputs)).toContain("November 7");expect(JSON.stringify(outputs)).not.toMatch(/PRIVATE_PROMPT|PRIVATE_MEMORY/);
	expect((await api("conversations.list")).find((r:any)=>r.conversationKey==="bot:bot_analyst")).toEqual(before);
	expect(await api("bots.memory.get",{botId:"bot_analyst"})).toEqual(memory);
	expect((await api("conversations.snapshot",{botId:core})).approvals).toEqual([]);
	await h.shot("01-core-history-read-en");
});
it("group Core searches only current public history and denies a forged private read",async()=>{
	await api("groups.change",{requestId:"create",action:"create",groupId:"group_app",expectedRevision:0,fields:{name:"Research studio",objective:"Research",memberIds:["bot_analyst","bot_reviewer"],leadBotId:"bot_analyst"}});
	h.model.script({text:"ORBIT_B24 群内计划在十一月八日完成。"});
	await api("groups.send",{groupId:"group_app",requestId:"history",text:"请记录群里的计划。"});
	await poll(async()=>(await api("groups.snapshot",{groupId:"group_app"})).roots[0]?.state).toBe("completed");
	await api("settings.update",{language:"zh-CN"});await h.page().reload();
	await h.page().locator(".group-nav").filter({hasText:"Research studio"}).click();
	h.model.script(
		{tool:"codemode",args:{code:`const search=await tools.app_conversations_search({query:"ORBIT_B24"});const hit=search.value.items.find(i=>i.senderId!=="user");const read=await tools.app_conversations_read({conversationKey:hit.conversationKey,anchorMessageId:hit.messageId,before:1,after:1});const denied=await tools.app_conversations_read({conversationKey:"bot:bot_analyst",anchorMessageId:${JSON.stringify(privateHit.messageId)}});const bots=await tools.app_bots_list({});text([search,read,denied,bots]);`}},
		{text:"本群的计划是十一月八日；私聊读取被拒绝。"},
	);
	await h.page().locator(".compose-area textarea").fill("搜索 ORBIT_B24，读取本群上下文，再尝试私聊访问以验证权限。");await h.page().locator(".compose-area textarea").press("Enter");
	await h.page().getByText("本群的计划是十一月八日；私聊读取被拒绝。",{exact:true}).waitFor();
	const results=toolResults(h.model.requests.at(-1)!).at(-1);
	expect(results.at(-4)?.value.items.every((h:any)=>h.conversationKey==="group:group_app")).toBe(true);
	expect(results.at(-3)?.value.messages.some((m:any)=>m.text.includes("十一月八日"))).toBe(true);
	expect(results.at(-2)).toMatchObject({ok:false,error:{code:"permission_denied"}});
	expect(results.at(-1)?.value.items.map((b:any)=>b.botId).sort()).toEqual([core,"bot_analyst","bot_reviewer"].sort());
	expect(JSON.stringify(results)).not.toMatch(/November 7|PRIVATE_PROMPT|PRIVATE_MEMORY|bot_outside/);
	await h.shot("02-group-scoped-read-zh");
});
it("keeps tools scoped after restart and reports Chinese read activity; Specialists cannot guess app tools",async()=>{
	await h.relaunch();await selectBot("OpenBot");
	h.model.script(composed("星图"),{text:"重启后仍可读取历史星图记录。"});
	await send("查找之前关于星图的记录并读取上下文。");await done(core);
	await h.page().getByText("重启后仍可读取历史星图记录。",{exact:true}).waitFor();
	await h.page().getByText("已读取应用数据",{exact:true}).last().click();
	await h.page().getByText("已搜索聊天记录",{exact:true}).last().waitFor();await h.page().getByText("已读取聊天上下文",{exact:true}).last().waitFor();
	expect(toolResults(h.model.requests.at(-1)!).at(-1)?.ok).toBe(true);await h.shot("03-core-read-zh-restart");
	h.model.script({tool:"codemode",args:{code:'const result=await tools.app_conversations_read({conversationKey:"bot:bot_analyst",anchorMessageId:"absent"});text(result);'}},{text:"原消息已不可用。"});
	await send("读取一条已不存在的历史消息。");await done(core);
	await h.page().getByText("原消息已不可用。",{exact:true}).waitFor();
	await h.page().getByText("已读取应用数据",{exact:true}).last().click();
	await h.page().locator(".code-activity li[data-state=failed]").last().waitFor();
	await h.shot("04-read-error-zh");
	await selectBot("Reviewer");const start=h.model.requests.length;
	h.model.script({tool:"app_conversations_search",args:{query:"ORBIT_B24"}},{text:"I cannot access the application history API."});
	await send("Try to search application history.");await done("bot_reviewer");
	expect(JSON.stringify(h.model.requests[start]?.tools)).not.toContain("app_conversations_search");
	expect(JSON.stringify(h.model.requests[start]?.tools)).not.toContain("codemode");
	expect(JSON.stringify(toolResults(h.model.requests.at(-1)!))).not.toContain("November 7");
	await h.page().getByText("I cannot access the application history API.",{exact:true}).waitFor();
});

it("keeps the desktop responsive during a script, stops it, and rejects caught floods",async()=>{
 await selectBot("OpenBot");await api("settings.update",{language:"en"});await h.page().reload();
 h.model.script({tool:"codemode",args:{code:"while(true) {}"}});
 await send("Run a cancellable computation.");
 await h.page().getByText("Reading application data",{exact:true}).last().waitFor();
 await h.page().getByRole("button",{name:"Stop",exact:true}).click();
 await poll(async()=>{const s=await api("conversations.snapshot",{botId:core});return s.items.filter((i:any)=>i.tool==="codemode").at(-1)?.execution?.state;}).toBe("cancelled");
 h.model.script({tool:"codemode",args:{code:'for(let i=0;i<100000;i++){try{text("x".repeat(1000));}catch{}}'}},{text:"The output limit stopped the script."});
 await send("Try an output flood.");await done(core);
 await h.page().getByText("Code Mode execution failed",{exact:true}).waitFor();
 await h.shot("05-code-limit-and-stop");
 await h.relaunch();
 const executions=(await api("conversations.snapshot",{botId:core})).items.filter((i:any)=>i.execution).map((i:any)=>i.execution);
 expect(executions.some((e:any)=>e.state==="cancelled")).toBe(true);expect(executions.at(-1).state).toBe("failed");
});
