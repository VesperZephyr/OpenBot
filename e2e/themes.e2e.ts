import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
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
        function luminance(color: string) {
            const channels = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
            return channels.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
        }
        const a = luminance(fg), b = luminance(bg);
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
        await h.shot(`${name.toLowerCase()}-approval`);
        await approval.getByRole("button",{name:"Deny",exact:true}).click();
        await h.page().getByText(`${name} decision received.`,{exact:true}).waitFor();
    }
});
