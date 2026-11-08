import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";
import { settingsScrollBeforeLanguageOpen, viewportSize } from "./pilot-ui.ts";
let h: AppHarness;
let windowSize = { width: 1280, height: 820 };
const button = (name: string) => h.page().getByRole("button", {name, exact:true});
const settings = () => h.page().getByRole("button", {name:/^Settings/}).click();
const select = () => h.page().locator('.bot-row').filter({hasText:'Canvas'}).click();
beforeAll(async () => {
    h = await launchApp('chat-interaction');
    windowSize = await h.app().evaluate(({ BrowserWindow }) => {
        const size = BrowserWindow.getAllWindows()[0]?.getSize();
        return { width: size?.[0] ?? 1280, height: size?.[1] ?? 820 };
    });
    await createBot(h, 'Canvas');
}, 60000);
afterEach(async () => { await restoreSharedChat(); });
afterAll(async () => { await h?.close(); });

/** One app serves every test. A throw used to leave Settings open, and Back returns home after relaunch, so later composers never mount. */
async function restoreSharedChat(): Promise<void> {
    if (h === undefined) return;
    const page = h.page();
    if (page.isClosed()) return;
    const composer = page.getByRole('textbox', { name: /^(Message Canvas|发送消息给 Canvas)$/ });
    for (let attempt = 0; attempt < 4 && !(await composer.isVisible().catch(() => false)); attempt++) {
        const popup = page.locator('[role="listbox"], [role="menu"], [role="dialog"]').first();
        if (await popup.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape');
            await h.nextFrame();
            continue;
        }
        const back = page.getByRole('button', { name: /^(Back to chat|返回聊天)$/ });
        if (await back.isVisible().catch(() => false)) {
            await back.click();
            await h.nextFrame();
            continue;
        }
        const canvas = page.locator('.sidebar .bot-row').filter({ hasText: 'Canvas' }).first();
        if (await canvas.isVisible().catch(() => false)) await canvas.click();
        break;
    }
    await composer.waitFor({ timeout: 5000 }).catch(() => {});
    const resized = await h.app().evaluate(({ BrowserWindow }, size) => {
        const hostWindow = BrowserWindow.getAllWindows()[0];
        if (!hostWindow) return false;
        const [width, height] = hostWindow.getSize();
        if (width === size.width && height === size.height) return false;
        hostWindow.setSize(size.width, size.height);
        return true;
    }, windowSize);
    if (resized) await h.nextFrame();
}

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
    await appearance('Light').focus();
    await h.page().keyboard.press('ArrowRight');
    await expect.poll(() => appearance('Dark').isChecked()).toBe(true);
    await h.page().keyboard.press(' ');
    await expect.poll(() => h.page().locator('html').getAttribute('data-theme')).toBe('dark');
    const language = h.page().locator('#settings-language').getByRole('button', {name:/Language/});
    const settingsScroll = h.page().locator('.settings-content');
    // Sample after the snapshot settles. On a short placeholder page this clamps (CI saw 69); the full page then mounts and the click scrolls the trigger to 107.
    const scrollBefore = await settingsScrollBeforeLanguageOpen(h.page(), 180);
    await language.click();
    await h.page().getByRole('listbox').waitFor();
    await h.page().emulateMedia({colorScheme:'light'});
    await expect.poll(() => h.page().locator('html').getAttribute('data-theme')).toBe('dark');
    const popupAgrees = await h.page().evaluate(() => {
        const popup = document.querySelector('[role="listbox"]');
        const probe = document.createElement("div");
        probe.style.background = "var(--surface-raised)";
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return popup !== null && getComputedStyle(popup).backgroundColor === expected;
    });
    expect(popupAgrees).toBe(true);
    await h.page().keyboard.press('Escape');
    await h.page().getByRole('listbox').waitFor({state:'hidden'});
    expect(await settingsScroll.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
    expect(await h.page().locator('html').getAttribute('lang')).toBe('en');
    await appearance('Light').check();
    for (const destination of ['Skills','Connect apps','Routines']) {
        await h.page().getByRole('navigation', {name:'Settings navigation'}).getByRole('button', {name:destination,exact:true}).click();
        await h.page().getByRole('heading', {name:destination,exact:true}).waitFor();
    }
    await select();
    await settings();
    await button('Back to chat').click();
    expect(await h.page().getByRole('textbox', {name:'Message Canvas'}).inputValue()).toBe('Keep this draft');
    const peer = await h.api('bots.create', {requestId:'pilot-peer', name:'Peer'});
    const canvas = (await h.api('bots.list')).find((bot: {name: string; botId: string}) => bot.name === 'Canvas');
    const group = await h.api('groups.change', {requestId:'pilot-group', action:'create', groupId:'group_pilot_draft', expectedRevision:0, fields:{name:'Pilot group', objective:'Draft check', memberIds:[canvas.botId, peer.botId], leadBotId:canvas.botId}});
    await h.page().getByRole('button', {name:/Pilot group/}).click();
    await h.page().getByRole('textbox', {name:'Message group'}).fill('Keep the group draft');
    await settings();
    await h.page().getByRole('radio', {name:'Dark', exact:true}).check();
    await h.page().getByRole('button', {name:'Back to chat'}).click();
    expect(await h.page().getByRole('textbox', {name:'Message group'}).inputValue()).toBe('Keep the group draft');
    await h.page().getByRole('button', {name:/Canvas/}).click();
    expect(await h.page().getByRole('textbox', {name:'Message Canvas'}).inputValue()).toBe('Keep this draft');
    await h.page().getByRole('textbox', {name:'Message Canvas'}).fill('');
    expect(group.groupId).toBe('group_pilot_draft');
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
    await expect.poll(async () => (await h.api('lifecycle.get')).transitioning).toBe(false);
    await button('Resume and continue').waitFor();
    await h.app().evaluate(({powerMonitor}) => powerMonitor.emit('lock-screen'));
    await h.page().getByText('Unlock your Mac to continue.', {exact:true}).waitFor();
    expect(await button('Resume and continue').isDisabled()).toBe(true);
    await h.app().evaluate(({powerMonitor}) => powerMonitor.emit('unlock-screen'));
    await expect.poll(() => button('Resume and continue').isEnabled()).toBe(true);
    const bot = (await h.api('bots.list')).find((bot: any) => bot.name === 'Canvas');
    const interrupted = (await h.api('conversations.snapshot', {botId:bot.botId})).run;
    await h.shot('03-paused-task');
    h.model.script({text:'Continued from the saved result without repeating the write.'});
    await button('Resume and continue').click();
    await h.page().getByText('Continued from the saved result without repeating the write.',{exact:true}).waitFor();
    expect((await h.api('lifecycle.get')).blocked).toBe(false);
    expect(await readFile(join(h.workspace,'d7-count.txt'),'utf8')).toBe('once\n');
    expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain('reconcile uncertain effects');
    const first = await h.api('runs.continue', {runId:interrupted.runId,requestId:`continue:${interrupted.runId}`});
    const second = await h.api('runs.continue', {runId:interrupted.runId,requestId:`continue:${interrupted.runId}`});
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
    await h.api('settings.update', {language:'zh-CN'});
    await h.app().evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.setSize(880,700));
    await h.page().getByRole('button', {name:/^设置/}).click();
    await h.page().getByRole('radio', {name:'深色',exact:true}).check();
    await h.shot('06-settings-compact-zh-dark');
    expect(await h.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await h.page().getByRole('radio', {name:'浅色',exact:true}).check();
    await button('返回聊天').click();
    await h.shot('07-chat-compact-zh');
});

it('reports a rejected language update and a failed appearance save, then retries', async () => {
    await h.api('settings.update', {language:'en'});
    await h.page().getByRole('button', {name:/^Settings/}).click();
    await h.page().evaluate(() => {
        const calls = (window as any).openbotCalls;
        const original = calls['settings.update'];
        (window as any).__settingsUpdate = original;
        calls['settings.update'] = (params: {language?: string}) => params.language ? Promise.reject(new Error('language save failed')) : original(params);
    });
    await h.page().locator('#settings-language').getByRole('button', {name:/Language/}).click();
    await h.page().getByRole('option', {name:'简体中文', exact:true}).click();
    await h.page().getByRole('status').getByText('language save failed', {exact:true}).waitFor();
    expect(await h.page().locator('html').getAttribute('lang')).toBe('en');
    expect(await h.page().locator('#settings-language').getByRole('button', {name:/Language/}).textContent()).toContain('English');
    await h.page().evaluate(() => { (window as any).openbotCalls['settings.update'] = (window as any).__settingsUpdate; });
    await button('Dismiss').click();
    await h.page().locator('#settings-language').getByRole('button', {name:/Language/}).click();
    await h.page().getByRole('option', {name:'简体中文', exact:true}).click();
    await expect.poll(() => h.page().locator('html').getAttribute('lang')).toBe('zh-CN');
    await h.api('settings.update', {language:'en'});
    await h.page().evaluate(() => {
        const original = localStorage.setItem.bind(localStorage);
        (window as any).__setItem = original;
        localStorage.setItem = (key: string, value: string) => {
            if (key === 'openbot.appearance') throw new Error('appearance save failed');
            original(key, value);
        };
    });
    const theme = await h.page().locator('html').getAttribute('data-theme');
    await h.page().getByRole('radio', {name:'Dark', exact:true}).click();
    await h.page().getByRole('status').getByText('appearance save failed', {exact:true}).waitFor();
    expect(await h.page().locator('html').getAttribute('data-theme')).toBe(theme);
    expect(await h.page().getByRole('radio', {name:'Light', exact:true}).isChecked()).toBe(theme !== 'dark');
    await h.page().evaluate(() => { localStorage.setItem = (window as any).__setItem; });
    await button('Dismiss').click();
    await h.page().getByRole('radio', {name:'Dark', exact:true}).click();
    await expect.poll(() => h.page().locator('html').getAttribute('data-theme')).toBe('dark');
    await h.page().getByRole('radio', {name:'Light', exact:true}).click();
    await button('Back to chat').click();
});

it('chooser owns focus and hands off to legacy editors', async () => {
    const draft = h.page().getByRole('textbox', {name:'Message Canvas'});
    await draft.fill('Chooser draft');
    await h.page().evaluate(() => {
        const legacy = document.createElement('div');
        legacy.setAttribute('role', 'dialog');
        legacy.setAttribute('aria-label', 'Legacy under test');
        legacy.style.cssText = 'position:fixed;width:12px;height:12px;top:0;left:0';
        const close = document.createElement('button');
        close.dataset.dialogClose = '';
        close.textContent = 'Legacy under close';
        close.addEventListener('click', () => legacy.remove());
        legacy.append(close);
        document.body.append(legacy);
    });
    await h.page().getByRole('button', {name:'New', exact:true}).click();
    const chooser = h.page().getByRole('dialog', {name:'New conversation', exact:true});
    await chooser.waitFor();
    await h.nextFrame();
    expect(await chooser.getByRole('button', {name:'Close', exact:true}).evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await h.page().getByRole('dialog').count()).toBe(2);
    await h.page().keyboard.press('Tab');
    expect(await chooser.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await h.page().keyboard.press('Shift+Tab');
    expect(await chooser.getByRole('button', {name:'Close', exact:true}).evaluate((element) => element === document.activeElement)).toBe(true);
    await h.page().evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true, isComposing:true}));
    });
    await h.nextFrame();
    expect(await chooser.count()).toBe(1);
    await h.page().mouse.click(8, 8);
    await h.nextFrame();
    expect(await chooser.count()).toBe(1);
    await h.page().keyboard.press('Escape');
    await h.nextFrame();
    expect(await chooser.count()).toBe(0);
    expect(await h.page().getByRole('dialog', {name:'Legacy under test'}).count()).toBe(1);
    await h.page().keyboard.press('Escape');
    await h.nextFrame();
    expect(await h.page().getByRole('dialog').count()).toBe(0);
    await h.page().keyboard.press('Control+n');
    await chooser.waitFor();
    const closeBox = await chooser.getByRole('button', {name:'Close', exact:true}).boundingBox();
    expect(closeBox!.width).toBeGreaterThanOrEqual(32);
    expect(closeBox!.height).toBeGreaterThanOrEqual(32);
    await chooser.getByRole('button', {name:/^Create new Bot/}).click();
    const editor = h.page().locator('.dialog-backdrop').filter({ has: h.page().getByRole('heading', { name: 'Create a Bot', exact: true }) });
    await editor.waitFor();
    await h.nextFrame();
    expect(await h.page().getByRole('dialog').count()).toBe(0);
    expect(await h.page().getByPlaceholder('Piper').evaluate((element) => element === document.activeElement)).toBe(true);
    await h.page().keyboard.press('Escape');
    await h.nextFrame();
    expect(await editor.count()).toBe(0);
    expect(await h.page().getByRole('button', {name:'New', exact:true}).evaluate((element) => element === document.activeElement)).toBe(true);
    expect(await draft.inputValue()).toBe('Chooser draft');
    await h.page().getByRole('button', {name:'New', exact:true}).click();
    await chooser.getByRole('button', {name:/^Create group/}).click();
    const group = h.page().getByRole('dialog', {name:'Create group', exact:true});
    await group.waitFor();
    await h.nextFrame();
    expect(await group.getByRole('textbox').first().evaluate((element) => element === document.activeElement)).toBe(true);
    await group.getByRole('button', {name:'Cancel', exact:true}).click();
    await h.nextFrame();
    expect(await draft.inputValue()).toBe('Chooser draft');
    await draft.fill('');
    const size = await viewportSize(h.page());
    await writeFile(join(h.run, 'chooser-viewport.json'), JSON.stringify(size));
});
