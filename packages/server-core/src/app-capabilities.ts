import { validAppInput, validAppOutput } from "@openbot/protocol/app-validation";
/** Authorized application reads. Transport adapters select identity; no request JSON carries authority. */
import { createHash } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	APP_MAX_RESULT_BYTES, appCapability, appToolCapability, ProtocolError,
	type AppCapabilityId, type AppErrorCode, type AppReadAuthority, type AppReadValue, type AppResult,
	type ConversationKey, type ConversationSummary, type ExecutionTarget, type HostParams, type JsonValue, type ToolOutcome,
} from "@openbot/protocol";
import type { ManagementCall } from "./bot-management.ts";

type Call = ManagementCall & { appAuthority?: AppReadAuthority; target?: ExecutionTarget };
type Scope = { principal: string; groupId?: string };
type Input = { query?: string; unreadOnly?: boolean; includeHidden?: boolean; conversationKey?: ConversationKey; cursor?: string; anchorMessageId?: string; before?: number; after?: number };
class AppFailure extends Error {
	readonly code: AppErrorCode;
	constructor(code: AppErrorCode, message: string) { super(message); this.code = code; }
}
const fail = (code: AppErrorCode, message: string): never => { throw new AppFailure(code, message); };
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lexical = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Budget includes JSON escaping and UTF-8 bytes; never cut a Unicode code point. */
export function boundedText(source: string, maxBytes: number): { text: string; truncated: boolean } {
	let bytes = 2, text = "";
	for (const point of source) {
		const next = size(point) - 2;
		if (bytes + next > maxBytes) return { text, truncated: true };
		text += point; bytes += next;
	}
	return {text, truncated: false};
}
function page<T>(values: readonly T[], key: (value:T)=>string, binding: string, cursor?: string): {items:T[];nextCursor?:string} {
	let after = "";
	if (cursor) {
		try {
			const decoded = JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
			if (!decoded || Object.keys(decoded).sort().join() !== "after,binding" || decoded.binding !== binding || typeof decoded.after !== "string" || !decoded.after) throw Error();
			after = decoded.after;
		} catch { fail("invalid_request", "Invalid application cursor"); }
	}
	const remaining = values.filter(v=>lexical(key(v),after)>0).sort((a,b)=>lexical(key(a),key(b)));
	const items = remaining.slice(0,50);
	const result = () => ({items, ...(remaining.length > items.length && items.length ? {nextCursor:Buffer.from(JSON.stringify({binding,after:key(items.at(-1)!)})).toString("base64url")} : {})});
	while(size({ok:true,value:result()})>APP_MAX_RESULT_BYTES) {
		items.pop();
		if (!items.length) fail("resource_limit","Application result exceeds the size limit");
	}
	return result();
}
export class AppCapabilities {
	private readonly runtime: BotRuntime;
	private readonly targetId: string;
	private readonly groupAdmissible: (run: import("@openbot/agent-runtime").StoredRun)=>Promise<boolean>;
	constructor(runtime: BotRuntime, targetId: string, groupAdmissible: (run: import("@openbot/agent-runtime").StoredRun)=>Promise<boolean>) { this.runtime = runtime; this.targetId = targetId; this.groupAdmissible = groupAdmissible; }

	async #modelScope(call: Call): Promise<Scope> {
		call.signal.throwIfAborted();
		const authority = call.appAuthority;
		const bot = await this.runtime.getBot(call.botId);
		if (bot?.kind !== "core" || bot.status !== "active" || call.target?.kind !== "local" || call.target.targetId !== this.targetId || !authority || authority.runId !== call.runId)
			return fail("permission_denied","Application access is not authorized");
		const run = await this.runtime.runsStore().get(authority.runId);
		if (!run || run.state !== "running" || run.botId !== call.botId || run.origin !== authority.origin || (run.channelId ?? "direct") !== authority.channelId || run.requestIds[0] !== authority.rootRequestId || await this.runtime.conversationKey(call.botId, authority.channelId) !== call.conversationId)
			return fail("permission_denied","Application access is not authorized");
		const principal = fingerprint([this.targetId,call.botId,call.conversationId,authority]);
		if (authority.channelId === "direct") {
			if (run.origin !== "user") return fail("permission_denied","Application access is not authorized");
			return {principal};
		}
		if (!await this.groupAdmissible(run)) return fail("permission_denied","Application access is not authorized");
		const delivery = (await this.runtime.groups().deliveries()).find(d=>d.groupId === authority.channelId && d.botId === call.botId && run.requestIds.includes(`delivery:${d.deliveryId}`));
		const root = delivery?.rootId && (await this.runtime.groups().roots(authority.channelId)).find(r=>r.rootId===delivery.rootId);
		if (!root || root.coreBotId !== call.botId || root.state !== "running" || delivery?.transferId) return fail("permission_denied","Application access is not authorized");
		return {principal,groupId:authority.channelId};
	}
	async authorize(call: Call): Promise<{kind:"allow"}|{kind:"deny";reason:string}> {
		try { await this.#modelScope(call); return {kind:"allow"}; }
		catch { return {kind:"deny",reason:"Application access is not authorized"}; }
	}
	async invokeTool(call: Call): Promise<ToolOutcome> {
		const descriptor = appToolCapability(call.tool);
		const result = await this.#guard(async()=> {
			if (!descriptor) return fail("invalid_request","Unknown application capability");
			const scope = await this.#modelScope(call);
			const result = await this.#execute(descriptor.id,call.args,scope);
			await this.#modelScope(call);
			call.signal.throwIfAborted();
			return result;
		},call.signal);
		return {status: result.ok ? "succeeded" : call.signal.aborted ? "cancelled" : "failed", output:JSON.stringify(result),value:result as JsonValue};
	}
	/** Only the private desktop IPC adapter calls this method; principal is not supplied by JSON. */
	async desktopSearch(input: HostParams<"conversations.search">) {
		return this.#unwrap(await this.#guard(()=>this.#execute("conversations.search",input,{principal:`desktop:${this.targetId}`}))) as import("@openbot/protocol").ConversationSearchResult;
	}
	async desktopRead(input: import("@openbot/protocol").AppReadInput) {
		return this.#unwrap(await this.#guard(()=>this.#execute("conversations.read",input,{principal:`desktop:${this.targetId}`}))) as AppReadValue;
	}
	async desktopSummaries(): Promise<readonly ConversationSummary[]> {
		return (await this.#resources({principal:`desktop:${this.targetId}`},{includeHidden:true})).summaries;
	}
	#unwrap(result: AppResult<unknown>): unknown {
		if (result.ok) return result.value;
		throw new ProtocolError(result.error.code === "not_found" ? "not_found" : "invalid_request",result.error.message);
	}
	async #guard(action: ()=>Promise<AppResult<unknown>>, signal?: AbortSignal): Promise<AppResult<unknown>> {
		try { return await action(); } catch(error) {
			if (signal?.aborted) return {ok:false,error:{code:"cancelled",message:"Application read was cancelled"}};
			if (error instanceof AppFailure) return {ok:false,error:{code:error.code,message:error.message}};
			if (error instanceof ProtocolError && error.code === "invalid_request") return {ok:false,error:{code:"invalid_request",message:"Invalid application request or cursor"}};
			return {ok:false,error:{code:"not_found",message:"Application data is unavailable"}};
		}
	}
	async #resources(scope:Scope,input:Input) {
		const [allBots,allGroups,allSummaries] = await Promise.all([this.runtime.listBots(),this.runtime.groups().list(),this.runtime.conversationIndex().list()]);
		const group = scope.groupId ? allGroups.find(g=>g.groupId===scope.groupId) : undefined;
		const bots = allBots.filter(b=>b.status !== "deleted" && (scope.groupId ? group?.memberIds.includes(b.botId) || b.kind === "core" : b.status === "active" || input.includeHidden));
		const groups = allGroups.filter(g=>!scope.groupId || g.groupId===scope.groupId);
		const keys = new Set<ConversationKey>([...(!scope.groupId ? bots.map(b=>`bot:${b.botId}` as const) : []),...groups.map(g=>`group:${g.groupId}` as const)]);
		const summaries = allSummaries.filter(s=>keys.has(s.conversationKey));
		return {bots,groups,keys,summaries};
	}
	async #execute(id: AppCapabilityId, raw: unknown, scope: Scope): Promise<AppResult<unknown>> {
		const descriptor = appCapability(id);
		if (!descriptor || !validAppInput(id,raw)) return fail("invalid_request","Invalid application arguments");
		const input = raw as Input;
		if (scope.groupId && input.conversationKey && input.conversationKey !== `group:${scope.groupId}`) return fail("permission_denied","Application access is not authorized");
		const {bots,groups,keys,summaries} = await this.#resources(scope,{...input, ...(id === "conversations.read" ? {includeHidden:true} : {})});
		if (input.conversationKey && !keys.has(input.conversationKey)) return fail("not_found","Conversation is unavailable");
		const binding = fingerprint([1,id,scope,input.unreadOnly??false,input.includeHidden??false,input.conversationKey??null]);
		let value: unknown;
		switch(id) {
			case "conversations.search": {
				const eligible = new Set(summaries.filter(s=>(!input.unreadOnly || s.unreadCount>0) && (!input.conversationKey || s.conversationKey===input.conversationKey)).map(s=>s.conversationKey));
				value=this.runtime.searchConversations(input.query!,eligible,input.unreadOnly,input.includeHidden,input.cursor,binding);break;
			}
			case "conversations.list": value=page(summaries.filter(s=>!input.unreadOnly || s.unreadCount>0),s=>s.conversationKey,binding,input.cursor);break;
			case "bots.list": value=page(bots.map(b=>{
				const name=boundedText(b.name,1024),role=boundedText(b.role,2048);
				return {botId:b.botId,name:name.text,role:role.text,kind:b.kind,status:b.status,revision:b.revision,truncated:name.truncated||role.truncated};
			}),b=>b.botId,binding,input.cursor);break;
			case "groups.list": value=page(groups.map(g=>{const name=boundedText(g.name,1024);return {groupId:g.groupId,name:name.text,status:g.status,revision:g.revision,truncated:name.truncated};}),g=>g.groupId,binding,input.cursor);break;
			case "conversations.read": value=await this.#read(input);break;
		}
		const result = {ok:true as const,value};
		if (size(result)>descriptor.maxResultBytes) return fail("resource_limit","Application result exceeds the size limit");
		if (!validAppOutput(id,result)) return fail("resource_limit","Application result could not be validated");
		return result;
	}
	async #read(input:Input): Promise<AppReadValue> {
		const messages = await this.runtime.committedMessages(input.conversationKey!);
		const index = messages.findIndex(m=>m.id===input.anchorMessageId);
		if(index<0) return fail("not_found","Message is unavailable");
		const min=Math.max(0,index-(input.before??3)), max=Math.min(messages.length-1,index+(input.after??3));
		const clip=(at:number)=>{const m=messages[at]!;return {id:m.id,senderId:m.senderId,at:m.at,...boundedText(m.text,8192)};};
		let start=index,end=index;
		const items=[clip(index)];
		const result=():AppReadValue=>({conversationKey:input.conversationKey!,anchorMessageId:input.anchorMessageId!,messages:items,hasBefore:start>0,hasAfter:end<messages.length-1});
		for(let distance=1;distance<=10;distance++) {
			for(const at of [index-distance,index+distance]) {
				if(at<min||at>max) continue;
				const next=clip(at),candidate=at<index?[next,...items]:[...items,next];
				if(size({ok:true,value:{...result(),messages:candidate}})>APP_MAX_RESULT_BYTES) return result();
				if(at<index){items.unshift(next);start=at;}else{items.push(next);end=at;}
			}
		}
		return result();
	}
}
