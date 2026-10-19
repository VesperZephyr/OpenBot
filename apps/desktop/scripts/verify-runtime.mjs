// Exercise the staged Host from an unrelated directory before signing an installer. No UI, provider or owner data.
import { fork } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
export async function verifyRuntime(stage) {
 const root=await mkdtemp(join(tmpdir(),"openbot-bundle-check-"));
 await mkdir(join(root,"home"));await mkdir(join(root,"workspace"));
 const host=fork(resolve(stage,"host/host.mjs"),[],{execPath:resolve(stage,"node"),execArgv:[],cwd:root,silent:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,OPENBOT_HOME:join(root,"home"),OPENBOT_DATA_DIR:join(root,"data"),OPENBOT_WORKSPACE:join(root,"workspace"),OPENBOT_KEYCHAIN_SERVICE:`ai.openbot.bundle-check.${process.pid}`,OPENBOT_EXECUTOR_ENTRY:resolve(stage,"host/executor.mjs")}});
 host.on("message", message => {
  if (message.kind !== "credential.request") return;
  const status = {owner:"desktop-main",availability:"ready",configuredCount:0,legacyCount:0,migrationRequired:0};
  // Explicitly empty diagnostic parent: this process has no access to any real Keychain item.
  const result = message.operation === "list" ? {ids:[],status} : message.operation === "status" ? status : message.operation === "get" ? {value:null} : undefined;
  if(host.connected) host.send(result === undefined ? {kind:"credential.response",requestId:message.requestId,ok:false,code:"unavailable"} : {kind:"credential.response",requestId:message.requestId,ok:true,result});
 });
 let stderr="";host.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-4000);});host.stdout.resume();
 try {
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error("Bundled Host did not start")),15000);
   host.once("error",error=>{clearTimeout(timer);reject(error);});
   host.once("exit",code=>{clearTimeout(timer);reject(Error(`Bundled Host exited ${code}: ${stderr}`));});
   host.on("message",message=>{if(message.kind==="ready"){clearTimeout(timer);resolve();}});
  });
  console.log("Bundled Host and executor started with isolated local state");
 } finally {
  const ended=new Promise(resolve=>host.once("exit",resolve));
  if(host.exitCode===null && host.signalCode===null){host.kill("SIGTERM");const timer=setTimeout(()=>host.kill("SIGKILL"),5000);await ended;clearTimeout(timer);}
  await rm(root,{recursive:true,force:true});
 }
}
