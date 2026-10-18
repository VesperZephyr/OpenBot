import { validAppOutput } from "@openbot/protocol/app-validation";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotRuntime, type StoredRun } from "@openbot/agent-runtime";
import { scriptedModels, SCRIPTED_MODEL } from "@openbot/agent-runtime/testing";
import { APP_MAX_RESULT_BYTES, type AppReadAuthority } from "@openbot/protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppCapabilities } from "../src/app-capabilities.ts";
let runtime: BotRuntime, app: AppCapabilities, root: string, core: string;
const signal = new AbortController().signal;
const models = () => scriptedModels("ORBIT private evidence 星图", "New topic reply");
async function run(botId=core,channelId="direct",requestId="request",runId="run"):Promise<StoredRun> {
	const r:StoredRun={runId,botId,channelId,state:"running",origin:"user",requestIds:[requestId],messages:[],inputs:[],createdAt:1};
	await runtime.runsStore().put(r);return r;
}
async function call(tool="app_conversations_search",args:Record<string,unknown>={query:"ORBIT"},r?:StoredRun) {
	r ??= await runtime.runsStore().get("run");
	return {botId:r!.botId,conversationId:await runtime.conversationKey(r!.botId,r!.channelId),runId:r!.runId,callId:"call",tool,args,signal,target:{kind:"local" as const,targetId:"mac"},appAuthority:{runId:r!.runId,origin:r!.origin!,channelId:r!.channelId??"direct",rootRequestId:r!.requestIds[0]!} satisfies AppReadAuthority};
}
const value = (out: Awaited<ReturnType<AppCapabilities["invokeTool"]>>):any => {
	const result=JSON.parse(out.output);expect(out.value).toEqual(result);expect(result.ok,out.output).toBe(true);return result.value;
};
beforeEach(async()=>{
	root=await mkdtemp(join(tmpdir(),"openbot-capabilities-"));
	runtime=await BotRuntime.open({databasePath:join(root,"db"),models:models().models});
	core=(await runtime.ensureCoreBot(1)).botId;
	await runtime.setDefaultModel(SCRIPTED_MODEL);
	for(const botId of ["a","b","outside"]) await runtime.createBot({botId,name:botId,role:"Research",instructions:"PRIVATE_PROMPT",createdAt:1});
	await runtime.submitAndWait("a","old","Private user ORBIT");await runtime.snapshot("a");
	await runtime.reset("a");await runtime.submitAndWait("a","new","New topic");await runtime.snapshot("a");
	await run();
	app=new AppCapabilities(runtime,"mac",async r=>!!r.channelId && (await runtime.groups().get(r.channelId))?.status==="active");
});
afterEach(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});

it("shares scoped search/read with desktop and preserves history, unread and memory",async()=>{
	const before=await runtime.conversationIndex().list(),runs=await runtime.runsStore().list(),memory=await runtime.memory("a");
	const hit=value(await app.invokeTool(await call())).items.find((h:any)=>h.senderId==="a");
	expect(hit).toBeDefined();
	expect(value(await app.invokeTool(await call()))).toEqual(await app.desktopSearch({query:"ORBIT"}));
	const input={conversationKey:hit.conversationKey,anchorMessageId:hit.messageId};
	const read=value(await app.invokeTool(await call("app_conversations_read",input)));
	expect(read).toEqual(await app.desktopRead(input));
	expect(read.messages.map((m:any)=>m.text).join(" ")).toContain("New topic reply");
	expect(read.messages.map((m:any)=>m.text).join(" ")).not.toContain("PRIVATE_PROMPT");
	expect(await runtime.conversationIndex().list()).toEqual(before);expect(await runtime.runsStore().list()).toEqual(runs);expect(await runtime.memory("a")).toEqual(memory);
	await runtime.updateBot("a",{status:"hidden"});
	expect(value(await app.invokeTool(await call())).items).toEqual([]);
	expect(value(await app.invokeTool(await call("app_conversations_search",{query:"ORBIT",includeHidden:true}))).items.length).toBe(2);
	await runtime.updateBot("a",{status:"deleted"});expect(value(await app.invokeTool(await call("app_conversations_search",{query:"ORBIT",includeHidden:true}))).items).toEqual([]);
	expect((await app.invokeTool(await call("app_conversations_read",input))).status).toBe("failed");
});
it("rejects forged authority, stale Runs, targets, schema fields and capability names",async()=>{
	const valid=await call();
	for(const changed of [
		{botId:"a"},{conversationId:await runtime.conversationKey("a")},{runId:"other"},{appAuthority:null as any},
		{target:{kind:"local" as const,targetId:"other"}},
		...[{origin:"peer"},{channelId:"group_fake"},{rootRequestId:"forged"}].map(p=>({appAuthority:{...valid.appAuthority,...p} as AppReadAuthority})),
		{args:{query:"ORBIT",origin:"user"}},{args:{query:"ORBIT",actorId:core}},{args:{query:"ORBIT",before:100}},{tool:"settings.get"},
	]) expect((await app.invokeTool({...valid,...changed})).status).toBe("failed");
	const foreign=await run("a","direct","request","specialist");expect((await app.invokeTool(await call("app_bots_list",{},foreign))).status).toBe("failed");
	const old=(await runtime.runsStore().get("run"))!;await runtime.runsStore().put({...old,state:"completed"});
	await run(core,"direct","new","replacement");expect((await app.invokeTool(valid)).status).toBe("failed");
	const controller=new AbortController();controller.abort();expect((await app.invokeTool({...valid,signal:controller.signal})).status).toBe("cancelled");
});
it("binds cursors to principal, filters and scope and pages past deleted/new rows without duplication",async()=>{
	for(let i=0;i<57;i++) await runtime.createBot({botId:`page_${String(i).padStart(3,"0")}`,name:"🦊".repeat(90),role:"汉".repeat(400),createdAt:1});
	const first=value(await app.invokeTool(await call("app_bots_list",{})));
	expect(first.items.length).toBeLessThan(50);expect(first.nextCursor).toBeTruthy();
	expect(Buffer.byteLength(JSON.stringify({ok:true,value:first}))).toBeLessThanOrEqual(APP_MAX_RESULT_BYTES);
	for(const args of [{cursor:first.nextCursor,includeHidden:true},{cursor:"broken"}]) expect((await app.invokeTool(await call("app_bots_list",args))).status).toBe("failed");
	const another=await run(core,"direct","second","second");expect((await app.invokeTool(await call("app_bots_list",{cursor:first.nextCursor},another))).status).toBe("failed");
	await runtime.updateBot("page_056",{status:"deleted"});await runtime.createBot({botId:"000_new",name:"new",createdAt:1});
	const ids=first.items.map((x:any)=>x.botId);let cursor=first.nextCursor;
	while(cursor){const next=value(await app.invokeTool(await call("app_bots_list",{cursor})));ids.push(...next.items.map((x:any)=>x.botId));cursor=next.nextCursor;}
	expect(new Set(ids).size).toBe(ids.length);expect(ids).not.toContain("page_056");expect(ids).not.toContain("000_new");
	expect(validAppOutput("bots.list",{ok:true,value:{...first,credential:"forged"}})).toBe(false);
});
it("returns bounded Unicode context around an exact anchor and validates outgoing data",async()=>{
	const read=vi.spyOn(runtime,"committedMessages").mockResolvedValue(Array.from({length:25},(_,i)=>({id:`m${i}`,senderId:"a",at:i,text:'🦊汉"'.repeat(5000)})));
	const out=await app.invokeTool(await call("app_conversations_read",{conversationKey:"bot:a",anchorMessageId:"m12",before:10,after:10}));
	const result=value(out);expect(Buffer.byteLength(out.output)).toBeLessThanOrEqual(APP_MAX_RESULT_BYTES);
	expect(result.messages.some((m:any)=>m.id==="m12")).toBe(true);expect(result.messages.length).toBeLessThan(21);expect(result).toMatchObject({hasBefore:true,hasAfter:true});
	for(const m of result.messages){expect(m.truncated).toBe(true);expect(m.text).not.toMatch(/[\uD800-\uDBFF]$/);expect(Buffer.byteLength(JSON.stringify(m.text))).toBeLessThanOrEqual(8192);}
	expect(read).toHaveBeenCalledExactlyOnceWith("bot:a");
	expect((await app.invokeTool(await call("app_conversations_read",{conversationKey:"bot:b",anchorMessageId:"absent"}))).status).toBe("failed");
	read.mockRestore();
	const list=vi.spyOn(runtime,"listBots");list.mockResolvedValue([{...(await runtime.getBot("a"))!,kind:"invalid" as any}]);
	expect((await app.invokeTool(await call("app_bots_list",{}))).status).toBe("failed");list.mockRestore();
});
it("restricts group Core to public group messages and roster, never private or other-group context",async()=>{
	for(const groupId of ["group_one","group_two"]){
		await runtime.groups().change({requestId:groupId,action:"create",groupId,expectedRevision:0,fields:{name:groupId,objective:"private objective",memberIds:["a","b"],leadBotId:"a"}},1);
		await runtime.groups().post(groupId,"task","ORBIT public 星图",undefined,2);
	}
	for(let i=0;i<35;i++) await runtime.groups().post("group_one",`task_${i}`,"ORBIT public page",undefined,10+i);
	const d=(await runtime.groups().deliveries()).find(d=>d.groupId==="group_one")!;
	await runtime.ensureChannel(core,"group_one");
	const r=await run(core,"group_one",`delivery:${d.deliveryId}`,"group-run");
	const invoke=async(tool:string,args:Record<string,unknown>)=>app.invokeTool(await call(tool,args,r));
	const first=value(await invoke("app_conversations_search",{query:"ORBIT",includeHidden:true}));
	const hits=first.items;
	expect(first.nextCursor).toBeTruthy();
	const desktop=await app.desktopSearch({query:"ORBIT",includeHidden:true,conversationKey:"group:group_one"});
	expect((await invoke("app_conversations_search",{query:"ORBIT",includeHidden:true,cursor:desktop.nextCursor})).status).toBe("failed");
	expect((await invoke("app_conversations_search",{query:"different",includeHidden:true,cursor:first.nextCursor})).status).toBe("failed");
	expect(value(await invoke("app_conversations_search",{query:"ORBIT",includeHidden:true,cursor:first.nextCursor})).items).toHaveLength(6);
	expect(hits).toHaveLength(30);expect(hits[0].conversationKey).toBe("group:group_one");
	for(const conversationKey of ["bot:a","group:group_two"]){
		expect((await invoke("app_conversations_search",{query:"ORBIT",conversationKey})).status).toBe("failed");
		expect((await invoke("app_conversations_read",{conversationKey,anchorMessageId:hits[0].messageId})).status).toBe("failed");
	}
	expect(value(await invoke("app_groups_list",{})).items.map((g:any)=>g.groupId)).toEqual(["group_one"]);
	expect(value(await invoke("app_bots_list",{})).items.map((b:any)=>b.botId).sort()).toEqual(["a","b",core].sort());
	const context=value(await invoke("app_conversations_read",{conversationKey:hits[0].conversationKey,anchorMessageId:hits[0].messageId}));
	expect(JSON.stringify(context)).not.toMatch(/PRIVATE_PROMPT|Private user|private objective/);
	await runtime.groups().change({requestId:"dissolve",action:"dissolve",groupId:"group_one",expectedRevision:1},3);
	expect((await invoke("app_conversations_search",{query:"ORBIT"})).status).toBe("failed");
	expect((await app.desktopSearch({query:"ORBIT",conversationKey:"group:group_one"})).items).toHaveLength(30);
});
