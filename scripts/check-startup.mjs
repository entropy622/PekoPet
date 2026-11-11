import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setModelLocation } from '../plugin/model-locations.ts';
import { modelPath } from '../plugin/model-path.mjs';
import { State } from '../plugin/state.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.PEKO_UI_OUT || join(root, 'work/startup-checks'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(root, 'work/startup-home-')), avatars = JSON.parse(readFileSync(join(root, 'assets/avatars.json'))).avatars, id = process.env.PEKO_TEST_LIBRARY ? 'deepseek' : 'yumi';
setModelLocation(home, id, process.env.PEKO_TEST_LIBRARY ? join(process.env.PEKO_TEST_LIBRARY, avatars[id].library) : modelPath(id), avatars);
const db = new State(join(home, 'peko-pet/state.sqlite3'));
db.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify({ avatar: id, petScale: .5 }));
db.close();
const cached = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'peko-pet/icons', id + '-head.png');
if (existsSync(cached)) {
    mkdirSync(join(home, 'peko-pet/icons'), { recursive: true });
    copyFileSync(cached, join(home, 'peko-pet/icons', id + '-head.png'));
}
mkdirSync(join(home, 'profiles/desktop'), { recursive: true });
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), '- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch = join(home, 'fixture.yml');
writeFileSync(patch, `- insert:\n    - id: fixture-model\n      name: '${pathToFileURL(join(root, 'tests/replay-adapter.mjs')).href}'\n    - id: startup-gate\n      name: '${pathToFileURL(join(root, 'tests/startup-gate.mjs')).href}'\n`);
const release = join(home, 'startup-release');
if (process.env.PEKO_STARTUP_BASELINE)
    setTimeout(() => writeFileSync(release, ''), 5000);
const iconFile = join(home, 'peko-pet/icons', id + '-head.png'), cachedStamp = existsSync(iconFile) ? statSync(iconFile).mtimeMs : undefined;
const runtime = process.env.PEKO_UI_ROOT || root, start = Date.now(), report = { passed: false, home, errors: [] };
let app, closing = false;
const until = async (fn) => { const deadline = Date.now() + 180000; while (!await fn()) {
    if (Date.now() > deadline)
        throw Error('Startup condition timed out');
    await new Promise(r => setTimeout(r, 20));
} };
try {
    app = await electron.launch({ executablePath: process.env.PEKO_UI_EXE || createRequire(import.meta.url)('electron'), args: process.env.PEKO_UI_EXE ? ['--peko-test'] : [root, '--peko-test'], env: { ...process.env, DSH_HOME: home, PEKO_ROOT: runtime, PEKO_NODE: existsSync(join(runtime, 'node.exe')) ? join(runtime, 'node.exe') : process.execPath, PEKO_USER_DATA: join(home, 'user-data'), PEKO_AGENT_PATCH: patch }, timeout: 120000 });
    app.on('window', p => p.on('pageerror', e => { if (!closing)
        report.errors.push(String(e)); }));
    await until(() => app.windows().some(p => p.url().startsWith('peko-app://pet/')));
    const pet = app.windows().find(p => p.url().startsWith('peko-app://pet/')), page = app.windows().find(p => p.url().startsWith('peko-app://app/'));
    await pet.waitForFunction(() => window.__pekoAvatarTest, null, { timeout: 90000 });
    report.petMs = Date.now() - start;
    report.load = await pet.evaluate(() => window.__pekoAvatarTest.stats.load);
    console.log('Avatar load', JSON.stringify(report.load));
    const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.peko.invoke(command, args), { command, args });
    let state = await invoke('peko_state');
    report.agentReadyAtFirstPet = state.connected;
    report.stages = state.startup || {};
    report.iconAvatar = state.iconAvatar;
    report.modelFile = state.modelFile;
    const frame = await pet.evaluate(() => ({ png: window.__pekoAvatarTest.image(), visible: window.__pekoAvatarTest.step(0).visiblePixels }));
    assert.ok(frame.visible > 100);
    writeFileSync(join(out, 'pet-early.png'), Buffer.from(frame.png.split(',')[1], 'base64'));
    let wanted;
    if (!process.env.PEKO_STARTUP_BASELINE) {
        assert.equal(state.connected, false, 'The pet must render before the deliberately delayed agent is ready');
        assert.equal(state.iconAvatar, id);
        if (cachedStamp !== undefined) {
            assert.equal(statSync(iconFile).mtimeMs, cachedStamp, 'A valid cached portrait must not be rendered again');
            report.cachedPortraitReused = true;
        }
        assert.ok(existsSync(join(home, 'peko-pet/icons', id + '-head.ico')));
        for (let i = 0; i < 3; i++)
            await pet.evaluate(() => window.peko.invoke('pet_move', { x: 12, y: 8 }));
        wanted = (await invoke('peko_state')).settings;
    }
    writeFileSync(release, '');
    await page.waitForSelector('[data-peko-ready]', { timeout: 180000 });
    report.chatMs = Date.now() - start;
    state = await invoke('peko_state');
    report.stages = state.startup || {};
    assert.equal(state.connected, true);
    assert.equal(state.settings.avatar, id);
    assert.equal(state.avatarError, '');
    if (wanted) {
        const saved = await invoke('peko_request', { method: 'peko.settings' });
        assert.ok(Math.abs(saved.petX - wanted.petX) <= 1);
        assert.ok(Math.abs(saved.petY - wanted.petY) <= 1);
        report.earlyDragPersisted = true;
        const ico = join(home, 'peko-pet/icons', id + '-head.ico');
        report.icon = await app.evaluate(({ nativeImage }, file) => { const image = nativeImage.createFromPath(file); return { empty: image.isEmpty(), ...image.getSize() }; }, ico);
        assert.deepEqual(report.icon, { empty: false, width: 256, height: 256 });
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(JSON.stringify({ passed: true, petMs: report.petMs, chatMs: report.chatMs, agentReadyAtFirstPet: report.agentReadyAtFirstPet, stages: report.stages, iconAvatar: report.iconAvatar }));
}
catch (error) {
    report.error = String(error);
    throw error;
}
finally {
    closing = true;
    writeFileSync(release, '');
    await app?.close();
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
}
