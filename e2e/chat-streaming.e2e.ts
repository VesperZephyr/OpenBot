import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness;
const api = (name: string, params = {}): Promise<any> => h.page().evaluate(({name, params}) => (window as any).openbot.methods[name](params), {name, params});
const button = (name: string) => h.page().getByRole("button", {name, exact:true});
const poll = (fn: () => Promise<any>) => expect.poll(fn, {timeout:15000});
const row = (name: string) => h.page().locator(".chat-list .bot-row").filter({has: h.page().locator(".roster-name", {hasText:name})});
const activity = () => h.page().locator(".live-reply .reply-activity");
beforeAll(async () => {
    h = await launchApp("chat-streaming");
    h.page().setDefaultTimeout(10000);
    await api("settings.update", {defaultModel:{provider:"scripted",modelId:"scripted"}});
    for (const name of ["Hunter", "Reviewer"]) await api("bots.create", {requestId:name.toLowerCase(),name,role:"Research official releases"});
    await api("groups.change", {requestId:"radar",action:"create",groupId:"group_radar",expectedRevision:0,fields:{name:"Competitor radar",objective:"Daily evidence from two researchers",memberIds:["bot_hunter","bot_reviewer"],leadBotId:"bot_hunter"}});
}, 60000);
afterEach(async ({task}) => { if(task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });

it("combines groups and Bots by recency, with compact navigation and durable drafts", async () => {
    await row("Hunter").click();
    await h.page().locator(".compose-area textarea").fill("Keep my research draft");
    expect(await button("Pause all").count()).toBe(0);
    expect(await h.page().locator(".sidebar-footer").getByRole("button", {name:"Settings",exact:true}).count()).toBe(1);
    expect(await button("Settings").textContent()).toBe("");
    expect(await row("Competitor radar").getByRole("img", {name:"Group · 2 members"}).count()).toBe(1);
    await button("Settings").click();
    expect(await button("Pause all").isVisible()).toBe(true);
    await button("Back to chat").click();
    expect(await h.page().locator(".compose-area textarea").inputValue()).toBe("Keep my research draft");
    await h.page().keyboard.press("Meta+k");
    const search = h.page().getByRole("searchbox");
    await search.fill("radar");
    expect(await h.page().locator(".chat-list .bot-row").count()).toBe(1);
    await search.press("Escape");
    expect(await search.inputValue()).toBe("");
    await search.press("Escape");
    expect(await search.isVisible()).toBe(false);
    expect(await button("Search conversations").evaluate(el => el === document.activeElement)).toBe(true);
    h.model.script({text:"Radar is ready."});
    await api("groups.send", {groupId:"group_radar",requestId:"hello",text:"Check sources",recipientIds:["bot_reviewer"]});
    await poll(async () => (await api("groups.snapshot",{groupId:"group_radar"})).posts.some((post:any) => post.text === "Radar is ready.")).toBe(true);
    await poll(() => h.page().locator(".chat-list .roster-name").nth(1).textContent()).toBe("Competitor radar");
    await h.page().keyboard.press("Meta+2");
    await h.page().getByRole("heading", {name:"Competitor radar",exact:true}).waitFor();
    await h.shot("01-unified-list");
    await row("Hunter").click();
    await h.page().locator(".compose-area textarea").fill("");
});

it("shows submission feedback before acceptance and keeps empty streamed chunks visibly active", async () => {
    await h.app().evaluate(({ipcMain}) => {
        const original = (ipcMain as any)._invokeHandlers.get("openbot:call");
        (globalThis as any).d8Original = original;
        ipcMain.removeHandler("openbot:call");
        ipcMain.handle("openbot:call", async (event, method, params) => {
            if (method === "messages.submit") await new Promise(resolve => setTimeout(resolve, 900));
            return original(event, method, params);
        });
    });
    try {
        h.model.script({chunks:["", "", "The empty chunks did not hide progress."],delayMs:500,chunkDelayMs:600});
        await h.send("Wait for acceptance");
        await h.page().getByRole("status").filter({hasText:"Sending message"}).waitFor();
        await h.page().locator(".compose-area textarea").fill("A newer draft");
        await poll(() => activity().textContent()).toBe("Thinking…");
        await h.page().getByText("The empty chunks did not hide progress.",{exact:true}).waitFor();
        await poll(()=>activity().count()).toBe(0);
        expect(await h.page().locator(".compose-area textarea").inputValue()).toBe("A newer draft");
        await h.page().locator(".compose-area textarea").fill("");
    } finally {
        await h.app().evaluate(({ipcMain})=>{ipcMain.removeHandler("openbot:call");ipcMain.handle("openbot:call",(globalThis as any).d8Original);});
    }
});

it("shows first-token feedback and genuine incremental Markdown without replacing completed blocks", async () => {
    h.model.script({chunks:["## Release notes\n\n", "A checked **update**.\n\n", "```ts\nconst stable = ", "true;\n```\n\n", "[Official source](https://example.com", "/release)\n\nDone."],delayMs:1600,chunkDelayMs:650});
    await h.send("Show the release notes");
    await poll(() => activity().textContent()).toBe("Thinking…");
    await h.shot("02-first-token");
    await h.page().locator(".is-live h2").waitFor();
    await h.page().evaluate(() => { (window as any).__heading = document.querySelector(".is-live h2"); });
    await h.page().locator(".is-live strong").filter({hasText:"update"}).waitFor();
    expect(await h.page().evaluate(() => (window as any).__heading === document.querySelector(".is-live h2"))).toBe(true);
    await poll(() => activity().textContent()).toBe("Replying");
    await h.page().locator(".is-live pre").waitFor();
    await h.shot("03-streaming-markdown");
    await h.page().locator(".is-live").getByText("Official source", {exact:false}).waitFor();
    expect(await h.page().locator(".is-live a").count()).toBe(0);
    await h.page().locator(".is-live").waitFor({state:"hidden"});
    expect(await h.page().locator(".message-assistant").last().locator("pre").textContent()).toBe("const stable = true;");
    expect(await h.page().getByRole("link", {name:"Official source"}).getAttribute("href")).toBe("https://example.com/release");
    expect(await activity().count()).toBe(0);
});

it("keeps older reading anchored as chunks arrive, then follows when requested", async () => {
    h.model.script({chunks:[Array.from({length:40},(_,i)=>`Finding ${i+1}: verified source.\n\n`).join(""),...Array.from({length:8},(_,i)=>`New evidence ${i+1}.\n\n`)],chunkDelayMs:450,delayMs:200});
    await h.send("Give me the full evidence");
    const timeline = h.page().locator(".timeline-scroll");
    await h.page().getByText("Finding 40: verified source.",{exact:true}).waitFor();
    await timeline.evaluate(el => { el.scrollTop = 80; el.dispatchEvent(new Event("scroll")); });
    const top = await timeline.evaluate(el => el.scrollTop);
    await h.page().getByText("New evidence 3.",{exact:true}).waitFor();
    expect(Math.abs(await timeline.evaluate(el=>el.scrollTop) - top)).toBeLessThan(3);
    await h.page().getByRole("button", {name:/New activity · Jump to latest/}).click();
    await h.page().locator(".is-live").waitFor({state:"hidden"});
    await poll(() => timeline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
});

it("distinguishes approvals and running tools and clears activity after Stop or failure", async () => {
    h.model.script({tool:"local_exec",args:{command:"sleep 2; printf checked",description:"Check a source"}},{chunks:["Checked."],delayMs:500,chunkDelayMs:300});
    await h.send("Check a source with a command");
    await poll(() => activity().textContent()).toBe("Needs approval");
    expect(await activity().getAttribute("class")).not.toContain("is-active");
    await button("Allow once").click();
    await poll(() => activity().textContent()).toBe("Running a tool");
    await h.shot("04-tool-running");
    await h.page().getByText("Checked.",{exact:true}).waitFor();
    await poll(() => activity().count()).toBe(0);
    h.model.script({chunks:["Too late"],delayMs:10000,chunkDelayMs:500});
    await h.send("Wait for a long response");
    await poll(() => activity().textContent()).toBe("Thinking…");
    await button("Stop").click();
    await poll(() => activity().count()).toBe(0);
    expect(await h.page().getByText("Too late",{exact:true}).count()).toBe(0);
    h.model.script({error:"Provider unavailable for this test"});
    await h.send("Try again");
    await button("Retry").waitFor();
    expect(await activity().count()).toBe(0);
});

it("renders group authors and Markdown while streaming; respects reduced motion and compact Chinese dark UI", async () => {
    await row("Competitor radar").click();
    h.model.script({chunks:["## Group findings\n\n", "- Official changelog checked\n", "- No invented dates\n\n", "**Report complete.**"],delayMs:1000,chunkDelayMs:800});
    await h.page().locator(".compose-area textarea").fill("Give me the group findings");
    await button("Send").click();
    await poll(() => activity().textContent()).toBe("Thinking…");
    expect(await h.page().locator(".live-reply .message-author").textContent()).toContain("OpenBot");
    await h.page().locator(".group-task-live h2").waitFor();
    await h.shot("05-group-streaming");
    await h.page().locator(".group-task-live").waitFor({state:"hidden"});
    await h.page().getByRole("group",{name:"Collaboration task"}).waitFor({state:"hidden"});
    expect(await h.page().locator(".group-post h2").last().textContent()).toBe("Group findings");
    await button("Settings").click();
    await h.page().getByRole("radio",{name:"Dark",exact:true}).check();
    await button("Back to chat").click();
    await api("settings.update",{language:"zh-CN"});
    await h.page().emulateMedia({reducedMotion:"reduce"});
    await h.app().evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setSize(880,700));
    h.model.script({chunks:["已核实。"],delayMs:2000,chunkDelayMs:400});
    await h.page().locator(".compose-area textarea").fill("再次核实");
    await button("发送").click();
    await activity().waitFor();
    expect(await h.page().locator(".activity-dots i").first().evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
    expect(await h.page().evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await h.shot("06-compact-zh-dark");
    await poll(()=>activity().count()).toBe(0);
});
