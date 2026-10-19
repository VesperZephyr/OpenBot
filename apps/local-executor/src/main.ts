/**
 * Local executor process. Started by the Host with an IPC channel; serves the executor protocol (Section 6.2) for the
 * bound local target over the receipt ledger in `<data>/executor/receipts.sqlite`, saves cut tool output under
 * `<data>/artifacts`, and exits when the Host goes away, stopping the commands it supervises.
 */
import { validConnectorControl, validBackgroundKeys, validSkillOperation } from "@openbot/protocol";
import { ConnectorSupervisor, SkillStore } from "@openbot/local-executor";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { validArtifactRequest } from "@openbot/protocol/schemas";
import { ArtifactStore, DEFAULT_YIELD_MS, EXECUTOR_TOOLS, LocalExecutor, pruneArtifacts, ReceiptLedger } from "@openbot/local-executor";
import { type ExecutorMessage, type ExecutorRequest, PROTOCOL_VERSION } from "@openbot/protocol";

const targetId = process.env.OPENBOT_TARGET_ID;
const workspace = process.env.OPENBOT_WORKSPACE;
const dataDirectory = process.env.OPENBOT_DATA_DIR;
if (targetId === undefined || workspace === undefined || dataDirectory === undefined || process.send === undefined) {
	console.error("The local executor must be started by the Host Runtime");
	process.exit(2);
}
/** Tests shorten how long a foreground command runs before it moves to the background; unset or invalid means the default. */
const yieldSetting = Number(process.env.OPENBOT_EXEC_YIELD_MS);
const yieldMs = process.env.OPENBOT_EXEC_YIELD_MS && Number.isInteger(yieldSetting) && yieldSetting > 0 ? yieldSetting : DEFAULT_YIELD_MS;

const ledgerDirectory = join(dataDirectory, "executor");
mkdirSync(ledgerDirectory, { recursive: true, mode: 0o700 });
// Canonical, because `local_read` compares canonical paths against it.
mkdirSync(join(dataDirectory, "artifacts"), { recursive: true, mode: 0o700 });
const artifactsDirectory = realpathSync(join(dataDirectory, "artifacts"));
pruneArtifacts(artifactsDirectory);
// Opening converts receipts a previous executor left `accepted` to `unknown`, marks its background tasks `unknown`,
// and kills their orphaned process groups.
const ledger = ReceiptLedger.open(join(ledgerDirectory, "receipts.sqlite"));
const skillStore = new SkillStore(join(dataDirectory, "skills"));
const artifactStore = new ArtifactStore(join(dataDirectory, "attachments"));
const connectors = new ConnectorSupervisor(join(ledgerDirectory,"connectors.sqlite"),targetId,workspace,id=>send({kind:"connector.changed",connectorId:id}));
const executor = new LocalExecutor({
 connectors,
	artifactStore,
 requireAuthority:true,
	targetId,
	workspace,
	ledger,
	artifactsDirectory,
	...(Number.isFinite(yieldMs) && yieldMs >= 0 ? { yieldMs } : {}),
});
const send = (message: ExecutorMessage): void => {
	if (process.connected) process.send?.(message, (error) => {
		if (error) shutdown();
	});
};

process.on("message", (message: ExecutorRequest) => {
	switch (message.kind) {
  case "connector.control": {
   const started=Date.now();
   void (async()=>{
    try {
     if(message.targetId!==targetId||typeof message.messageId!=="string"||!message.messageId||message.messageId.length>256||typeof message.requestId!=="string"||!message.requestId||message.requestId.length>256||!Number.isSafeInteger(message.authorityRevision)||message.authorityRevision<0||!validConnectorControl(message.operation)||Object.keys(message).some(key=>!["kind","messageId","requestId","targetId","authorityRevision","operation"].includes(key)))throw Error("Invalid connector control");
     const op=message.operation;
     let result;
     if(op.action==="connect"){
      if(!executor.authorizedOperation(message.requestId,message.authorityRevision))throw Error("Stale connector authority");
      result=await connectors.connect(op.definition,op.credential,()=>executor.authorizedOperation(message.requestId,message.authorityRevision));
     }else if(op.action==="disconnect"){
      const stopped=await connectors.disconnect(op.connectorId);
      result=connectors.inspect(op.connectorId);
      if(!stopped)result={...result,state:"needs_attention" as const,error:"Connector termination needs attention"};
     }else result=connectors.inspect(op.connectorId);
     console.info(JSON.stringify({type:"connector.control",requestId:message.requestId,connectorId:result.connectorId,state:result.state,durationMs:Date.now()-started}));
     send({kind:"connector.response",messageId:message.messageId,result});
    }catch{send({kind:"connector.response",messageId:message.messageId,error:"Connector control failed; inspect its state before retrying"});}
   })();return;
  }
		case "tasks.inspect": {
			if (Object.keys(message).some(key=>!["kind","messageId","targetId","keys","acknowledge"].includes(key)) || message.targetId !== targetId || typeof message.messageId !== "string" || !message.messageId || message.messageId.length > 256 || !validBackgroundKeys(message.keys) || (message.acknowledge !== undefined && typeof message.acknowledge !== "boolean")) {
				send({kind:"tasks.inspected",messageId:message.messageId,error:"Invalid background receipt request"}); return;
			}
			const receipts = message.keys.flatMap(key => {
				const receipt = ledger.task(key.taskId);
				if (!receipt || receipt.invocationId !== key.invocationId) return [];
				if (message.acknowledge) ledger.ackTask(key.taskId,key.invocationId);
				return [receipt];
			});
			send({kind:"tasks.inspected",messageId:message.messageId,receipts}); return;
		}
 case "skill.request": {
  const started=Date.now();
  try {
   if(message.targetId!==targetId||typeof message.messageId!=="string"||message.messageId.length>256||typeof message.requestId!=="string"||!message.requestId||message.requestId.length>2048||!validSkillOperation(message.operation)||Object.keys(message).some(k=>!["kind","messageId","requestId","targetId","operation","authorityRevision"].includes(k)))throw new Error("Invalid skill request");
   const op=message.operation;
   let result;
   if(op.action==="list")result=skillStore.list();
   else if(op.action==="get")result=skillStore.get(op.name,op.revision);
   else {
    result=skillStore.receipt(message.requestId,op);
    if(!result){if(!executor.authorizedOperation(message.requestId,message.authorityRevision))throw new Error("permission_revoked: stale skill authority");result=skillStore.change(message.requestId,op);}
   }
   console.info(JSON.stringify({type:"skill.operation",requestId:message.requestId,action:op.action,outcome:"succeeded",durationMs:Date.now()-started}));
   send({kind:"skill.response",messageId:message.messageId,result});
  }catch(error){
   console.info(JSON.stringify({type:"skill.operation",requestId:message.requestId,outcome:"failed",durationMs:Date.now()-started}));
   let uncertain=false;try{uncertain=typeof message.requestId==="string"&&skillStore.pendingRequest(message.requestId);}catch{uncertain=true;}
 send({kind:"skill.response",messageId:message.messageId,uncertain,error:error instanceof Error&&!("code" in error)?error.message:"Skill storage is unavailable"});
  }return;
 }
		case "artifact.request": {
			if (!validArtifactRequest(message) || message.targetId !== targetId) {
				send({ kind: "artifact.response", messageId: message.messageId, error: "Invalid artifact request" });
				return;
			}
			const started = Date.now();
			const audit = (outcome: string, ref?: import("@openbot/protocol").ArtifactRef) =>
				console.info(
					JSON.stringify({
						type: "artifact.operation",
						requestId: message.requestId,
						targetId,
						action: message.operation.action,
						at: started,
						durationMs: Date.now() - started,
						outcome,
						...(ref
							? { artifactId: ref.artifactId, mediaType: ref.mediaType, bytes: ref.bytes }
							: "artifactId" in message.operation
								? { artifactId: message.operation.artifactId }
								: {}),
					}),
				);
			try {
				const op = message.operation;
				let result;
				switch (op.action) {
					case "import":
						result = artifactStore.capture(message.requestId, op.path);
						break;
					case "get":
						result = artifactStore.get(op.artifactId);
						break;
					case "preview":
						result = artifactStore.content(op.artifactId, true);
						break;
					case "content":
						result = artifactStore.content(op.artifactId);
						break;
					case "remove":
						result = artifactStore.remove(message.requestId, op.artifactId);
						break;
					case "export":
						result = artifactStore.export(message.requestId, op.artifactId, op.path);
						break;
				}
				const ref = result
					? "artifact" in result
						? result.artifact
						: result
					: "artifactId" in op
						? artifactStore.get(op.artifactId)
						: undefined;
				audit("succeeded", ref);
				send({ kind: "artifact.response", messageId: message.messageId, result });
			} catch (error) {
				audit("failed");
				send({
					kind: "artifact.response",
					messageId: message.messageId,
					error: error instanceof Error && !("code" in error) ? error.message : "Could not access the selected attachment",
				});
			}
			return;
		}
  case "policy.sync":send({kind:"policy.synced",messageId:message.messageId,confirmed:message.targetId===targetId&&executor.synchronize(message.revision)});return;
  case "execution.revoke":{
   if(message.targetId!==targetId||!Array.isArray(message.invocationIds)||message.invocationIds.length>4096||message.invocationIds.some(id=>typeof id!=="string"||id.length>2048)){send({kind:"execution.quiesced",messageId:message.messageId,confirmed:false});return;}
   void executor.revoke(message.invocationIds).then(confirmed=>send({kind:"execution.quiesced",messageId:message.messageId,confirmed}),()=>send({kind:"execution.quiesced",messageId:message.messageId,confirmed:false}));return;
  }
		case "execution.quiesce": {
			if (
				message.targetId !== targetId ||
				typeof message.messageId !== "string" ||
				message.messageId.length > 256 ||
				Object.keys(message).length !== 3
			) {
				send({ kind: "execution.quiesced", messageId: message.messageId, confirmed: false });
				return;
			}
			void executor.cancelAll().then(
				(confirmed) => send({ kind: "execution.quiesced", messageId: message.messageId, confirmed }),
				() => send({ kind: "execution.quiesced", messageId: message.messageId, confirmed: false }),
			);
			return;
		}
		case "tool.invoke": {
			const { invocationId } = message.invocation;
 const started=Date.now();
			void executor
				.invoke(message.invocation, (output) => send({ kind: "tool.progress", invocationId, output }))
				.catch((error: unknown): import("@openbot/protocol").ToolOutcome => ({
					status: "unknown" as const,
					output: `The executor could not record this action's result: ${error instanceof Error ? error.message : String(error)}`,
				}))
				.then((outcome) => {
 if(message.invocation.tool.startsWith("mcp__"))console.info(JSON.stringify({type:"connector.invocation",invocationId,targetId,runId:message.invocation.runId,connectorId:message.invocation.connector?.connectorId,revision:message.invocation.connector?.revision,tool:message.invocation.tool,outcome:outcome.status,durationMs:Date.now()-started}));
					if (message.invocation.tool === "artifact_publish")
						console.info(
							JSON.stringify({
								type: "artifact.publication",
								invocationId,
								targetId,
								at: Date.now(),
								outcome: outcome.status,
								...(outcome.artifact
									? { artifactId: outcome.artifact.artifactId, mediaType: outcome.artifact.mediaType, bytes: outcome.artifact.bytes }
									: {}),
							}),
						);
					send({ kind: "tool.result", invocationId, outcome });
				});
			return;
		}
		case "tool.cancel":
			executor.cancel(message.invocationId);
			return;
		case "tool.status": {
			const receipt = executor.receipt(message.invocationId);
			send({
				kind: "tool.status",
				invocationId: message.invocationId,
				status: receipt?.status ?? "absent",
    ...(receipt?{argsDigest:receipt.argsDigest,tool:receipt.tool}:{}),
				...(receipt?.outcome === undefined ? {} : { outcome: receipt.outcome }),
			});
			return;
		}
		case "result.ack":
			executor.ack(message.invocationId);
			return;
		case "tasks.stop":
			executor.stopTasks(message.conversationId, message.runId);
	}
});

// Losing the Host means nobody can receive results: stop supervised commands, record their outcomes, then exit.
let stopping = false;
const shutdown = (): void => {
	if (stopping) return;
	stopping = true;
	setTimeout(() => process.exit(0), 3_500).unref();
	void executor.cancelAll().finally(async () => {
  await connectors.close();
		artifactStore.close();
 skillStore.close();
		ledger.close();
		process.exit(0);
	});
};
process.on("disconnect", shutdown);
process.on("SIGTERM", shutdown);

send({ kind: "executor.hello", protocolVersion: PROTOCOL_VERSION, targetId, instanceId: randomUUID(), tools: EXECUTOR_TOOLS });
