import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
import { viewportSize } from "./pilot-ui.ts";
let h: AppHarness;
const button = (name: string) => h.page().getByRole("button", {name, exact:true});
const settings = () => h.page().getByRole("button", {name:/^Settings/}).click();
async function theme(name: string) {
    await settings();
    await h.page().getByRole("radio", {name, exact:true}).check();
    await contrast(".settings-navigation [aria-current]", ".settings-navigation [aria-current]");
    await button("Back to chat").click();
}
async function contrast(foreground: string, background: string, pseudo?: string) {
    const value = await h.page().evaluate(({foreground,background,pseudo}) => {
        const fg = getComputedStyle(document.querySelector(foreground)!,pseudo).color;
        const bg = getComputedStyle(document.querySelector(background)!).backgroundColor;
        function channels(color: string) {
            const match = color.match(/[\d.]+/g);
            if (!match || match.length < 3) throw new Error(`Unparseable color: ${color}`);
            const [r = 0, g = 0, b = 0, a = 1] = match.map(Number);
            return { r, g, b, a: match.length > 3 ? a : 1 };
        }
        function composite(front: {r:number;g:number;b:number;a:number}, back: {r:number;g:number;b:number;a:number}) {
            const alpha = front.a + back.a * (1 - front.a);
            const mix = (f: number, b: number) => alpha === 0 ? 0 : (f * front.a + b * back.a * (1 - front.a)) / alpha;
            return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b) };
        }
        function luminance(color: {r:number;g:number;b:number}) {
            return [color.r, color.g, color.b].map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
        }
        const painted = composite(channels(fg), channels(bg));
        const a = luminance(painted), b = luminance(channels(bg));
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }, {foreground,background,pseudo});
    expect(value, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
}
beforeAll(async () => {
    h = await launchApp("themes");
    await createBot(h,"Atlas");
    h.model.script({text:"## A little clarity for today\n\nWe can keep this simple. I’ve organized your notes into three next steps.\n\n> Start with the one thing that would make today feel easier.\n\n1. Review the outline together.\n2. Turn the strongest idea into a draft.\n3. Leave room to change direction.\n\nYour files stay on this Mac. You can ask me to adjust the plan at any point."});
    await h.send("Help me turn these ideas into a clear plan.");
    await h.page().getByText("A little clarity for today",{exact:true}).waitFor();
    await h.page().locator(".sidebar").getByText("Working",{exact:true}).waitFor({state:"hidden"});
    const markRead = button("Mark as read");
    if (await markRead.isVisible()) await markRead.click();
},60000);
afterAll(async () => { await h?.close(); });

it("designs readable chat, profile, menus, focus and Settings in both appearances", async () => {
    for (const name of ["Light","Dark"]) {
        await theme(name);
        const prefix = name.toLowerCase();
        const input = h.page().getByRole("textbox", {name:"Message Atlas"});
        await input.fill("Let’s start with the outline.");
        await contrast(".message-assistant .markdown", ".main");
        await contrast(".message-user", ".message-user");
        await contrast(".composer textarea", ".composer");
        await contrast(".composer textarea", ".composer", "::placeholder");
        await contrast(".composer .send", ".composer .send");
        await contrast(".markdown blockquote", ".markdown blockquote");
        await contrast(".sidebar .bot-row-role", ".sidebar");
        const legacy = await h.page().evaluate(() => {
            const message = document.querySelector(".message-assistant .markdown");
            if (!message) return null;
            const style = getComputedStyle(message);
            return { fontSize: style.fontSize, marginLeft: style.marginLeft, fontFamily: style.fontFamily };
        });
        expect(legacy).toMatchObject({ fontSize: "14px", marginLeft: "35px" });
        expect(legacy!.fontFamily.toLowerCase()).not.toContain("boardui");
        await h.shot(`${prefix}-chat`);
        await button("•••").click();
        await contrast(".menu-popover button", ".menu-popover");
        await h.shot(`${prefix}-menu`);
        await h.page().getByRole("menuitem",{name:"Delete…",exact:true}).click();
        await contrast(".dialog .danger", ".dialog .danger");
        await h.shot(`${prefix}-confirmation`);
        await button("Cancel").click();
        await button("Conversation details").click();
        await contrast(".profile-tabs [aria-selected=true]", ".profile-details");
        await contrast(".profile-details .primary", ".profile-details .primary");
        await contrast(".profile-fields textarea", ".profile-fields textarea", "::placeholder");
        await h.shot(`${prefix}-profile`);
        await h.page().keyboard.press("Escape");
        await settings();
        await contrast(".appearance-label", ".appearance-choice");
        await contrast(".settings-navigation [aria-current]", ".settings-navigation [aria-current]");
        await h.shot(`${prefix}-settings`);
        await button("Back to chat").click();
        expect(await input.inputValue()).toBe("Let’s start with the outline.");
        await input.fill("");
    }
});

it("keeps approval decisions readable and operable in both appearances", async () => {
    for (const name of ["Light","Dark"]) {
        await theme(name);
        h.model.script({tool:"local_exec",args:{command:"echo theme-preview",description:"Create a local draft"}},{text:`${name} decision received.`});
        await h.send("Prepare a draft in the workspace.");
        const approval = h.page().getByRole("group",{name:"Approval request"});
        await approval.waitFor();
        await contrast(".approval", ".approval");
        await contrast(".approval .primary", ".approval .primary");
        expect(await approval.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
        await h.shot(`${name.toLowerCase()}-approval`);
        await approval.getByRole("button",{name:"Deny",exact:true}).click();
        await h.page().getByText(`${name} decision received.`,{exact:true}).waitFor();
    }
});

it("captures the settings pilot and checks compact geometry", async () => {
    const seen: string[] = [];
    h.page().on("request", (request) => seen.push(request.url()));
    const viewports: { name: string; width: number; height: number }[] = [];
    const appearanceName = (language: "en" | "zh-CN", themeName: "Light" | "Dark") =>
        language === "en" ? themeName : themeName === "Light" ? "浅色" : "深色";
    for (const language of ["en", "zh-CN"] as const) {
        await h.api("settings.update", { language });
        for (const themeName of ["Light", "Dark"] as const) {
            await h.page().getByRole("button", { name: language === "en" ? /^Settings/ : /^设置/ }).click();
            await h.page().getByRole("radio", { name: appearanceName(language, themeName), exact: true }).check();
            for (const [width, height] of [[1280, 800], [880, 560]] as const) {
                await h.app().evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
                if ((await h.page().locator("#settings-language").count()) === 0)
                    await h.page().getByRole("button", { name: language === "en" ? /^Settings/ : /^设置/ }).click();
                const viewport = await viewportSize(h.page());
                const slug = `${language}-${themeName.toLowerCase()}-${width}`;
                viewports.push({ name: slug, ...viewport });
                await h.shot(`${slug}-appearance`);
                const trigger = h.page().locator("#settings-language").getByRole("button", { name: language === "en" ? /^Language/ : /^语言/ });
                expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(36);
                await trigger.click();
                const popup = h.page().getByRole("listbox");
                await popup.waitFor();
                await h.shot(`${slug}-language`);
                await h.page().keyboard.press("Escape");
                await h.page().getByRole("button", { name: language === "en" ? "Back to chat" : "返回聊天", exact: true }).click();
                await h.page().getByRole("button", { name: language === "en" ? "New" : "新建", exact: true }).click();
                const chooser = h.page().getByRole("dialog", { name: language === "en" ? "New conversation" : "新建会话", exact: true });
                await chooser.waitFor();
                const clipped = await chooser.locator("button").evaluateAll((nodes) => nodes.some((node) => node.scrollWidth > node.clientWidth + 1));
                expect(clipped).toBe(false);
                await h.shot(`${slug}-chooser`);
                await chooser.getByRole("button", { name: language === "en" ? "Close" : "关闭", exact: true }).click();
            }
        }
    }
    await writeFile(join(h.run, "boardui-viewports.json"), JSON.stringify(viewports, null, 2));
    await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 650));
    await h.page().getByRole("button", { name: /^设置/ }).click();
    expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await h.page().locator("#settings-language").getByRole("button", { name: /^语言/ }).click();
    const popupInside = await h.page().getByRole("listbox").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
    });
    expect(popupInside).toBe(true);
    await h.page().keyboard.press("Escape");
    await h.page().getByRole("button", { name: "新建", exact: true }).click();
    const compactChooser = h.page().getByRole("dialog", { name: "新建会话", exact: true });
    const reachable = await compactChooser.evaluate((element) => {
        const actions = [...element.querySelectorAll("button")];
        return actions.every((action) => action.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1 || element.scrollHeight > element.clientHeight);
    });
    expect(reachable).toBe(true);
    expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await compactChooser.getByRole("button", { name: "关闭", exact: true }).click();
    await h.page().emulateMedia({ reducedMotion: "reduce" });
    await h.page().getByRole("button", { name: /^设置/ }).click();
    const trigger = h.page().locator("#settings-language").getByRole("button", { name: /^语言/ });
    await trigger.focus();
    expect(await trigger.evaluate((element) => getComputedStyle(element).transitionDuration === "0s" || getComputedStyle(element).animationName === "none")).toBe(true);
    await h.shot("boardui-reduced-motion-focus");
    const resources = await h.page().evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    const remote = [...seen, ...resources].filter((url) => /boardui|fonts\.gstatic|fonts\.googleapis|fonts\.cdn/i.test(url));
    expect(remote).toEqual([]);
});
