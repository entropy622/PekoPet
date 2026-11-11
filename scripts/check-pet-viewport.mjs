import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { State } from '../plugin/state.mjs';
import { setModelLocation } from '../plugin/model-locations.ts';
import { modelPath } from '../plugin/model-path.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.PEKO_UI_OUT || join(root, 'work/pet-viewport'));
mkdirSync(out, { recursive: true });
const avatars = JSON.parse(readFileSync(join(root, 'assets/avatars.json'), 'utf8')).avatars, home = mkdtempSync(join(root, 'work/pet-viewport-home-'));
const ids = ['deepseek', 'yumi', 'strawberry-rabbit'].filter(id => {
    const library = process.env.PEKO_TEST_LIBRARY ? join(process.env.PEKO_TEST_LIBRARY, avatars[id].library || avatars[id].model) : modelPath(id);
    if (!existsSync(library))
        return false;
    setModelLocation(home, id, library, avatars);
    return true;
});
assert.ok(ids.length, 'At least one real Live2D model is required');
const seed = new State(join(home, 'peko-pet/state.sqlite3'));
seed.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify({ avatar: ids[0], petScale: 1 }));
seed.close();
mkdirSync(join(home, 'profiles/desktop'), { recursive: true });
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), '- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch = join(home, 'fixture.yml');
writeFileSync(patch, `- insert:\n    - id: test-model\n      name: '${pathToFileURL(join(root, 'tests/replay-adapter.mjs')).href}'\n`);
const executable = process.env.PEKO_UI_EXE || createRequire(import.meta.url)('electron'), runtime = process.env.PEKO_UI_ROOT || root;
const args = process.env.PEKO_UI_EXE ? ['--peko-test'] : [root, '--peko-test'];
const { PNG } = createRequire(import.meta.url)('pngjs');
let app, page, pet, closing = false;
const report = { passed: false, models: [], drag: [], errors: [], home };
const until = async (f) => { const deadline = Date.now() + 120000; while (!await f()) {
    if (Date.now() > deadline)
        throw Error('Viewport condition timed out');
    await new Promise(r => setTimeout(r, 30));
} };
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.peko.invoke(command, args), { command, args });
const petInvoke = (command, args = {}) => pet.evaluate(({ command, args }) => window.peko.invoke(command, args), { command, args });
async function launch() { closing = false; app = await electron.launch({ executablePath: executable, args, env: { ...process.env, DSH_HOME: home, PEKO_ROOT: runtime, PEKO_NODE: existsSync(join(runtime, 'node.exe')) ? join(runtime, 'node.exe') : process.execPath, PEKO_USER_DATA: join(home, 'user-data'), PEKO_AGENT_PATCH: patch }, timeout: 120000 }); app.on('window', p => p.on('pageerror', error => { if (!closing)
    report.errors.push(String(error)); })); await until(() => app.windows().some(p => p.url().startsWith('peko-app://app/'))); page = app.windows().find(p => p.url().startsWith('peko-app://app/')); await page.waitForSelector('[data-peko-ready]', { timeout: 120000 }); }
async function select(id) { await invoke('peko_request', { method: 'peko.settings', params: { patch: { avatar: id } } }); await until(() => app.windows().some(p => p.url() === 'peko-app://pet/?avatar=' + id)); pet = app.windows().find(p => p.url() === 'peko-app://pet/?avatar=' + id); await pet.waitForFunction(name => window.__pekoAvatarTest?.catalog.name === name, avatars[id].name, { timeout: 90000 }); }
async function frame() {
    const data = await pet.evaluate(() => { window.__pekoAvatarTest.step(0); return window.__pekoAvatarTest.image(); }), png = PNG.sync.read(Buffer.from(data.split(',')[1], 'base64'));
    let left = png.width, top = png.height, right = -1, bottom = -1, solid;
    for (let y = 0; y < png.height; y++)
        for (let x = 0; x < png.width; x++)
            if (png.data[(y * png.width + x) * 4 + 3] > 30) {
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
                if (!solid && y > png.height * .35 && y < png.height * .65 && x > png.width * .35 && x < png.width * .65)
                    solid = { x: x / png.width, y: y / png.height };
            }
    assert.ok(right > left && bottom > top);
    return { data, png, bounds: { left: left / png.width, top: top / png.height, right: right / png.width, bottom: bottom / png.height }, solid };
}
async function nativeBounds() { return (await app.browserWindow(pet)).evaluate(window => window.getBounds()); }
async function waitSize(scale) { await until(async () => { const bounds = await nativeBounds(); return Math.abs(bounds.width - 400 * scale) <= 1 && Math.abs(bounds.height - 600 * scale) <= 1 && await pet.evaluate(({ width, height, scale }) => innerWidth === width && innerHeight === height && document.querySelector('canvas').width === Math.round(400 * scale * devicePixelRatio) && document.querySelector('canvas').height === Math.round(600 * scale * devicePixelRatio), { ...bounds, scale }); }); }
try {
    await launch();
    for (const id of ids) {
        console.log('Checking ' + id);
        await select(id);
        await petInvoke('pet_action', { action: 'reset-size' });
        await petInvoke('pet_action', { action: 'recover' });
        await pet.evaluate(() => window.__pekoAvatarTest.release());
        await waitSize(1);
        const baseline = await frame();
        for (const scale of [.25, .5, 1, 2]) {
            const old = await invoke('peko_state');
            const delta = -Math.log(scale / old.settings.petScale) / .001;
            await pet.locator('canvas').dispatchEvent('wheel', { deltaY: delta, deltaMode: 0, clientX: 200 * old.settings.petScale, clientY: 300 * old.settings.petScale });
            await waitSize(scale);
            const image = await frame();
            for (const edge of ['left', 'top', 'right', 'bottom'])
                assert.ok(Math.abs(image.bounds[edge] - baseline.bounds[edge]) < .07, id + ' must retain its normalized full model bounds at scale ' + scale + ' ' + edge);
            assert.ok(image.bounds.left > 0 && image.bounds.top > 0 && image.bounds.right < .999 && image.bounds.bottom < .999, 'Avatar must not touch the canvas clipping edges');
            writeFileSync(join(out, id + '-' + scale + '.png'), Buffer.from(image.data.split(',')[1], 'base64'));
            report.models.push({ id, scale, window: await nativeBounds(), pixels: [image.png.width, image.png.height], model: image.bounds });
        }
    }
    await select(ids[0]);
    await petInvoke('pet_action', { action: 'reset-size' });
    await petInvoke('pet_action', { action: 'recover' });
    await waitSize(1);
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ id: String(d.id), bounds: d.bounds })));
    for (const scale of [.25, .5, 1, 2]) {
        await petInvoke('pet_scale', { delta: -Math.log(scale / (await invoke('peko_state')).settings.petScale) / .001 });
        await waitSize(scale);
        for (const [x, y] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6], [-1e6, -1e6]]) {
            await petInvoke('pet_action', { action: 'recover' });
            await petInvoke('pet_move', { x, y });
            const state = await invoke('peko_state'), b = await nativeBounds(), area = displays.find(d => d.id === state.settings.petMonitor).bounds;
            const fx = Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x)) / b.width, fy = Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y)) / b.height;
            assert.ok(fx >= .25 && fy >= .25);
            if (x)
                assert.ok(fx < .25 + 2 / b.width);
            if (y)
                assert.ok(fy < .25 + 2 / b.height);
            report.drag.push({ scale, bounds: b, visibleX: fx, visibleY: fy, visibleArea: fx * fy });
        }
    }
    await petInvoke('pet_action', { action: 'recover' });
    const before = await nativeBounds(), state = await invoke('peko_state');
    await pet.locator('canvas').dispatchEvent('wheel', { deltaY: -Math.log(1.2 / state.settings.petScale) / .001, clientX: before.width * .3, clientY: before.height * .45 });
    await waitSize(1.2);
    const after = await nativeBounds();
    assert.ok(Math.abs((before.x + before.width * .3) - (after.x + after.width * .3)) <= 1);
    assert.ok(Math.abs((before.y + before.height * .45) - (after.y + after.height * .45)) <= 1);
    const image = await frame();
    assert.ok(image.solid);
    await pet.locator('canvas').dispatchEvent('mousemove', { clientX: 0, clientY: 0 });
    await until(async () => (await invoke('peko_state')).petWindow.ignoringMouse === true);
    await pet.locator('canvas').dispatchEvent('mousemove', { clientX: image.solid.x * after.width, clientY: image.solid.y * after.height });
    await until(async () => (await invoke('peko_state')).petWindow.ignoringMouse === false);
    await invoke('peko_request', { method: 'peko.settings', params: { patch: { clickThrough: true } } });
    await until(async () => (await invoke('peko_state')).petWindow.ignoringMouse === true);
    await invoke('peko_request', { method: 'peko.settings', params: { patch: { clickThrough: false } } });
    await until(async () => (await invoke('peko_state')).petWindow.ignoringMouse === false);
    assert.deepEqual(await petInvoke('pet_context_menu'), ['放大', '缩小', '恢复默认大小', '移回屏幕内']);
    await pet.mouse.move(image.solid.x * after.width, image.solid.y * after.height);
    await pet.mouse.down();
    await until(async () => (await invoke('peko_state')).petWindow.dragging === true);
    await pet.mouse.move(image.solid.x * after.width + 25, image.solid.y * after.height + 20);
    await pet.mouse.up();
    await until(async () => (await invoke('peko_state')).petWindow.dragging === false);
    await petInvoke('pet_scale', { delta: -Math.log(.25 / 1.2) / .001 });
    await waitSize(.25);
    await petInvoke('pet_move', { x: -1e6, y: -1e6 });
    const saved = await invoke('peko_state');
    const backend = await invoke('peko_request', { method: 'peko.settings' });
    assert.equal(backend.petScale, saved.settings.petScale);
    assert.equal(backend.petX, saved.settings.petX);
    closing = true;
    await app.close();
    await launch();
    await select(ids[0]);
    await waitSize(saved.settings.petScale);
    const restored = await nativeBounds();
    assert.equal(restored.x, saved.settings.petX);
    assert.equal(restored.y, saved.settings.petY);
    assert.deepEqual(report.errors, []);
    report.passed = true;
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('Viewport checks passed: ' + report.models.length + ' real-model scales; per-axis 75% bounds, cursor anchor, transparent hit testing, drag and restart');
}
catch (error) {
    report.error = String(error);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    throw error;
}
finally {
    closing = true;
    await app?.close();
}
