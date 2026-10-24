import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
let h: AppHarness;
const api = (method: string, params: object = {}) => h.page().evaluate(({method, params}) => (window as any).openbot.methods[method](params), {method, params});
const button = (name: string) => h.page().getByRole("button", {name, exact:true});
const settings = () => h.page().getByRole("button", {name:/^Settings/}).click();
const select = () => h.page().locator('.bot-row').filter({hasText:'Canvas'}).click();
beforeAll(async () => { h = await launchApp('chat-interaction'); await createBot(h, 'Canvas'); }, 60000);
afterAll(async () => { await h?.close(); });

it('defaults to white under a dark OS, saves appearance, and keeps drafts through Settings destinations', async () => {
    await h.page().emulateMedia({colorScheme:'dark'});
    expect(await h.page().evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#ffffff');
    await h.page().getByRole('textbox', {name:'Message Canvas'}).fill('Keep this draft');
    expect(await h.page().locator('.sidebar-footer').getByRole('button', {name:'Settings',exact:true}).count()).toBe(1);
    await settings();
    const appearance = (name: string) => h.page().getByRole('radio', {name, exact:true});
    await appearance('System').check();
    await expect.poll(() => h.page().locator('html').getAttribute('data-theme')).toBe('dark');
    await h.page().emulateMedia({colorScheme:'light'});
    await expect.poll(() => h.page().locator('html').getAttribute('data-theme')).toBe('light');
    await appearance('Dark').check();
    await h.relaunch();
    await settings();
    expect(await appearance('Dark').isChecked()).toBe(true);
    await appearance('Light').check();
    for (const destination of ['Skills','Connect apps','Routines']) {
        await h.page().getByRole('navigation', {name:'Settings navigation'}).getByRole('button', {name:destination,exact:true}).click();
        await h.page().getByRole('heading', {name:destination,exact:true}).waitFor();
    }
    await select();
    await settings();
    await button('Back to chat').click();
    expect(await h.page().getByRole('textbox', {name:'Message Canvas'}).inputValue()).toBe('Keep this draft');
    await h.page().getByRole('textbox', {name:'Message Canvas'}).fill('');
    await h.shot('01-white-chat');
    await settings(); await h.shot('02-settings'); await button('Back to chat').click();
});

it('pauses actual execution and explicitly resumes an interrupted task without replaying its write', async () => {
    h.model.script({tool:'local_exec',args:{command:"printf 'once\\n' >> d7-count.txt; sleep 30; printf 'late\\n' >> d7-count.txt",description:'Pause and continue probe'}});
    await h.send('Write once, then wait');
    await h.page().getByRole('group', {name:'Approval request'}).getByRole('button', {name:'Allow once',exact:true}).click();
    await expect.poll(() => readFile(join(h.workspace,'d7-count.txt'),'utf8').catch(()=> '')).toBe('once\n');
    await settings();
    await button('Pause all').click();
    await button('Back to chat').click();
    await expect.poll(async () => (await api('lifecycle.get')).transitioning).toBe(false);
    await button('Resume and continue').waitFor();
    await h.app().evaluate(({powerMonitor}) => powerMonitor.emit('lock-screen'));
    await h.page().getByText('Unlock your Mac to continue.', {exact:true}).waitFor();
    expect(await button('Resume and continue').isDisabled()).toBe(true);
    await h.app().evaluate(({powerMonitor}) => powerMonitor.emit('unlock-screen'));
    await expect.poll(() => button('Resume and continue').isEnabled()).toBe(true);
    const bot = (await api('bots.list')).find((bot: any) => bot.name === 'Canvas');
    const interrupted = (await api('conversations.snapshot', {botId:bot.botId})).run;
    await h.shot('03-paused-task');
    h.model.script({text:'Continued from the saved result without repeating the write.'});
    await button('Resume and continue').click();
    await h.page().getByText('Continued from the saved result without repeating the write.',{exact:true}).waitFor();
    expect((await api('lifecycle.get')).blocked).toBe(false);
    expect(await readFile(join(h.workspace,'d7-count.txt'),'utf8')).toBe('once\n');
    expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain('reconcile uncertain effects');
    const first = await api('runs.continue', {runId:interrupted.runId,requestId:`continue:${interrupted.runId}`});
    const second = await api('runs.continue', {runId:interrupted.runId,requestId:`continue:${interrupted.runId}`});
    expect(second.runId).toBe(first.runId);
    await h.shot('04-continued-task');
});

it('shows a single stop action while working, preserves follow-up input, and stops model work', async () => {
    h.model.script({text:'Should be cancelled',delayMs:10000});
    await h.send('Think for a while');
    await button('Stop').waitFor();
    expect(await button('Send').count()).toBe(0);
    const input = h.page().getByRole('textbox', {name:'Message Canvas'});
    await input.fill('A follow-up');
    await input.press('Shift+Enter');
    expect(await input.inputValue()).toBe('A follow-up\n');
    expect(await button('Send').isEnabled()).toBe(true);
    await h.shot('05-follow-up');
    await button('Stop').click();
    await button('Stop').waitFor({state:'hidden'});
    expect(await input.inputValue()).toBe('A follow-up\n');
    h.model.script({text:'A fresh response after Stop.'});
    await button('Send').click();
    await h.page().getByText('A fresh response after Stop.',{exact:true}).waitFor();
    expect(await input.evaluate(el=>el===document.activeElement)).toBe(true);
});


it('keeps Chinese Settings usable in a compact window', async () => {
    await api('settings.update', {language:'zh-CN'});
    await h.app().evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.setSize(880,700));
    await h.page().getByRole('button', {name:/^设置/}).click();
    await h.page().getByRole('radio', {name:'深色',exact:true}).check();
    await h.shot('06-settings-compact-zh-dark');
    expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await h.page().getByRole('radio', {name:'浅色',exact:true}).check();
    await button('返回聊天').click();
    await h.shot('07-chat-compact-zh');
});
