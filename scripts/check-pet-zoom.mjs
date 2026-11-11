import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { State } from '../plugin/state.mjs';
import { setModelLocation } from '../plugin/model-locations.ts';
import { modelPath } from '../plugin/model-path.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.PEKO_UI_OUT || join(root, 'work/pet-zoom'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(root, 'work/zoom-home-')), avatars = JSON.parse(readFileSync(join(root, 'assets/avatars.json'))).avatars, id = process.env.PEKO_TEST_LIBRARY ? 'deepseek' : 'yumi';
setModelLocation(home, id, process.env.PEKO_TEST_LIBRARY ? join(process.env.PEKO_TEST_LIBRARY, avatars[id].library) : modelPath(id), avatars);
const state = new State(join(home, 'peko-pet/state.sqlite3'));
state.updateSettings({ avatar: id, petScale: .5 });
state.close();
mkdirSync(join(home, 'profiles/desktop'), { recursive: true });
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), '- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch = join(home, 'fixture.yml');
writeFileSync(patch, `- insert:\n    - id: fixture-model\n      name: '${pathToFileURL(join(root, 'tests/replay-adapter.mjs')).href}'\n`);
const runtime = process.env.PEKO_UI_ROOT || root, report = { passed: false, errors: [], runs: [] };
let app;
try {
    app = await electron.launch({ executablePath: process.env.PEKO_UI_EXE || createRequire(import.meta.url)('electron'), args: process.env.PEKO_UI_EXE ? ['--peko-test'] : [root, '--peko-test'], env: { ...process.env, DSH_HOME: home, PEKO_ROOT: runtime, PEKO_NODE: existsSync(join(runtime, 'node.exe')) ? join(runtime, 'node.exe') : process.execPath, PEKO_USER_DATA: join(home, 'user-data'), PEKO_AGENT_PATCH: patch }, timeout: 120000 });
    app.on('window', p => p.on('pageerror', e => report.errors.push(String(e))));
    const deadline = Date.now() + 120000;
    while (!app.windows().some(p => p.url().startsWith('peko-app://pet/'))) {
        if (Date.now() > deadline)
            throw Error('Pet startup timed out');
        await new Promise(r => setTimeout(r, 30));
    }
    const pet = app.windows().find(p => p.url().startsWith('peko-app://pet/'));
    await pet.waitForFunction(() => window.__pekoAvatarTest, null, { timeout: 90000 });
    const page = app.windows().find(p => p.url().startsWith('peko-app://app/'));
    await pet.exposeFunction('__zoomState', () => page.evaluate(() => window.peko.invoke('peko_state')));
    if (process.env.PEKO_ZOOM_DPI) {
        const cdp = await app.context().newCDPSession(pet);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: Number(process.env.PEKO_ZOOM_DPI), mobile: false });
        await pet.waitForFunction(dpr => Math.abs(devicePixelRatio - dpr) < .01, Number(process.env.PEKO_ZOOM_DPI));
    }
    const native = await app.browserWindow(pet);
    await native.evaluate(w => { w.__paint = { frames: 0, blank: 0 }; w.webContents.on('paint', (_e, _r, img) => { const pixels = img.toBitmap(); let visible = false; for (let i = 3; i < pixels.length; i += 32)
        if (pixels[i] > 20) {
            visible = true;
            break;
        } w.__paint.frames++; if (!visible)
        w.__paint.blank++; }); });
    for (const burst of [1, 8]) {
        await pet.evaluate(() => window.peko.invoke('pet_action', { action: 'recover' }));
        const data = await pet.evaluate(async (burst) => {
            const t = window.__pekoAvatarTest, canvas = document.querySelector('canvas');
            t.release(); const initialResizes=t.inspect().bufferResizes;
            const before = await window.__zoomState(), b = before.petWindow, point = { x: b.x + b.width * .37, y: b.y + b.height * .43 }, samples = [];
            let current = b;
            const unlisten = await window.peko.listen('peko-state', ({ payload: s }) => { if (s.petWindow)
                current = s.petWindow; if (s.petWindow && s.settings.petScale !== before.settings.petScale)
                samples.push({ bounds: s.petWindow, scale: s.settings.petScale }); });
            for (const direction of [-1, 1])
                for (let frame = 0; frame < 24; frame++) {
                    for (let j = 0; j < burst; j++)
                        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * 12 / burst, deltaMode: 0, clientX: point.x - current.x, clientY: point.y - current.y, screenX: point.x, screenY: point.y, cancelable: true }));
                    await new Promise(requestAnimationFrame);
                }
            await new Promise(r => setTimeout(r, 350));
            unlisten();
            const after = await window.__zoomState(), frame = t.step(0);
            return { burst, before: b, after: after.petWindow, point, samples, visible: frame.visiblePixels, bufferResizes: frame.bufferResizes-initialResizes, png: t.image(), dpr: devicePixelRatio, canvas: [canvas.width, canvas.height], viewport: [innerWidth, innerHeight] };
        }, burst);
        writeFileSync(join(out, 'zoom-' + burst + '.png'), Buffer.from(data.png.split(',')[1], 'base64'));
        delete data.png;
        data.maxAnchorError = Math.max(0, ...data.samples.map(s => Math.max(Math.abs(s.bounds.x + s.bounds.width * .37 - data.point.x), Math.abs(s.bounds.y + s.bounds.height * .43 - data.point.y))));
        data.returnError = Math.max(Math.abs(data.before.x - data.after.x), Math.abs(data.before.y - data.after.y), Math.abs(data.before.width - data.after.width), Math.abs(data.before.height - data.after.height));
        report.runs.push(data);
    }
    report.paint = await native.evaluate(w => w.__paint);
    if (!process.env.PEKO_ZOOM_BASELINE) {
        for (const run of report.runs) {
            assert.ok(run.samples.length > 0);
            assert.ok(Math.max(...run.samples.map(s=>s.scale)) > .625, 'Wheel input must actually zoom the avatar');
            assert.ok(run.bufferResizes <= 48, 'Wheel bursts must be batched to at most one buffer resize per input frame');
            assert.ok(run.maxAnchorError <= 2, `Cursor anchor drifted ${run.maxAnchorError}px in burst ${run.burst}`);
            assert.ok(run.returnError <= 2, `Round trip drifted ${run.returnError}px`);
            assert.ok(run.visible > 100);
        }
        assert.equal(report.paint.blank, 0);
        assert.ok(report.paint.frames > 0);
        assert.deepEqual(report.errors, []);
    }
    report.passed = true;
    console.log(JSON.stringify({ runs: report.runs.map(({ burst, maxAnchorError, returnError, canvas, dpr }) => ({ burst, maxAnchorError, returnError, canvas, dpr })), paint: report.paint, errors: report.errors }));
}
catch (error) {
    report.error = String(error);
    throw error;
}
finally {
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    await app?.close();
}
