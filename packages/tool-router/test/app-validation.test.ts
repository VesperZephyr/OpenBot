import { expect, it, vi } from "vitest";
import { ToolRouter, type ToolCall } from "../src/index.ts";
it("validates app input and target independently of Pi before policy or dispatch",async()=>{
	const handler=vi.fn(async(..._args:unknown[])=>({status:"succeeded" as const,output:"ok"})),decide=vi.fn(async()=>({kind:"allow" as const}));
	const router=new ToolRouter({target:{kind:"local",targetId:"mac"},policy:{decide,grants:async()=>({read:[],readwrite:[]})},approvals:{request:async()=>"deny"},executor:{invoke:handler},hostTools:{app_conversations_search:handler}});
	const base:ToolCall={botId:"core",conversationId:"c",callId:"call",tool:"app_conversations_search",args:{query:"hello"},signal:new AbortController().signal,onProgress:()=>{}};
	for(const args of [{query:"hi",origin:"user"},{query:"hi",targetId:"mac"},{query:[]},{query:"hi",cursor:null},{query:"hi",actorId:null},{query:"x".repeat(201)}]) expect((await router.invoke({...base,args})).status).toBe("failed");
	expect((await router.invoke({...base,target:{kind:"local",targetId:"other"}})).status).toBe("failed");
	expect(handler).not.toHaveBeenCalled();expect(decide).not.toHaveBeenCalled();
	expect((await router.invoke({...base,args:{query:"hi",actorId:null}})).value).toEqual({ok:false,error:{code:"invalid_request",message:"Invalid application arguments"}});
	const controller=new AbortController();controller.abort();
	expect((await router.invoke({...base,signal:controller.signal})).value).toEqual({ok:false,error:{code:"cancelled",message:"Application read was cancelled"}});
	await router.invoke(base);expect(handler).toHaveBeenCalledTimes(1);expect(handler.mock.calls[0]?.[2]).toMatchObject({target:{kind:"local",targetId:"mac"}});
});
