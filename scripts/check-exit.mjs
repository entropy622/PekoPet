import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setModelLocation } from '../plugin/model-locations.ts';
import { modelPath } from '../plugin/model-path.mjs';
import { State } from '../plugin/state.mjs';
const root = resolve(import.meta.dirname, '..'), out = resolve(process.env.PEKO_UI_OUT || join(root, 'work/exit-checks'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(root, 'work/exit-home-')), errorFile = join(home, 'main-errors.jsonl'), avatars = JSON.parse(readFileSync(join(root, 'assets/avatars.json'), 'utf8')).avatars;
const id = process.env.PEKO_TEST_LIBRARY ? 'deepseek' : 'yumi';
setModelLocation(home, id, process.env.PEKO_TEST_LIBRARY ? join(process.env.PEKO_TEST_LIBRARY, avatars[id].library) : modelPath(id), avatars);
const state = new State(join(home, 'peko-pet/state.sqlite3'));
state.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify({ avatar: id }));
state.close();
mkdirSync(join(home, 'profiles/desktop'), { recursive: true });
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), '- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch = join(home, 'fixture.yml');
writeFileSync(patch, `- insert:\n    - id: fixture-model\n      name: '${pathToFileURL(join(root, 'tests/replay-adapter.mjs')).href}'\n`);
const runtime = process.env.PEKO_UI_ROOT || root, report = { passed: false, home, runs: [], errors: [] };
let app;
try {
    for (const scenario of process.env.PEKO_EXIT_BASELINE ? ['app.quit'] : ['app.quit', 'window_action', 'destroyed-pet']) {
        console.log('Exit check: '+scenario);
        app = await electron.launch({ executablePath: process.env.PEKO_UI_EXE || createRequire(import.meta.url)('electron'), args: process.env.PEKO_UI_EXE ? ['--peko-test'] : [root, '--peko-test'], env: { ...process.env, DSH_HOME: home, PEKO_ROOT: runtime, PEKO_NODE: existsSync(join(runtime, 'node.exe')) ? join(runtime, 'node.exe') : process.execPath, PEKO_USER_DATA: join(home, 'user-data'), PEKO_TEST_GAZE: '1', PEKO_AGENT_PATCH: patch }, timeout: 120000 });
        await app.evaluate(({ dialog }, file) => {
            const fs = process.getBuiltinModule('fs'), record = error => fs.appendFileSync(file, JSON.stringify({ message: String(error?.stack || error) }) + '\n');
            process.on('uncaughtException', record);
            process.on('unhandledRejection', record);
            dialog.showErrorBox = (title, body) => record(title + ': ' + body);
            const { ChildProcess } = process.getBuiltinModule('child_process'), send = ChildProcess.prototype.send;
            ChildProcess.prototype.send = function (message, ...args) { if (message?.payload?.v?.some(([key, value]) => key === 'method' && value === 'shutdown')) {
                setTimeout(() => send.call(this, message, ...args), 350);
                return true;
            } return send.call(this, message, ...args); };
        }, errorFile);
        const deadline = Date.now() + 180000;
        while (!app.windows().some(p => p.url().startsWith('peko-app://pet/'))) {
            if (Date.now() > deadline)
                throw Error('Pet startup timed out');
            await new Promise(r => setTimeout(r, 30));
        }
        const pet = app.windows().find(p => p.url().startsWith('peko-app://pet/'));
        await pet.waitForFunction(() => window.__pekoAvatarTest, null, { timeout: 90000 });
        await pet.evaluate(() => { window.__exitGaze = 0; window.peko.listen('avatar-gaze', () => window.__exitGaze++); });
        await pet.waitForFunction(() => window.__exitGaze >= 3);
        await app.windows().find(p=>p.url().startsWith('peko-app://app/')).waitForSelector('[data-peko-ready]',{timeout:180000});
        console.log('Gaze active: '+scenario);
        const before = Date.now(), child = app.process();
        let exitTimer;
        const exited = new Promise((resolve,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Process exit timed out')),15000);child.once('exit',code=>{clearTimeout(exitTimer);resolve(code);});});
        if (scenario === 'destroyed-pet') {
            await (await app.browserWindow(pet)).evaluate(w => w.destroy());
            await app.evaluate(() => new Promise(r => setTimeout(r, 200)));
        }
        if (scenario === 'window_action') {
            const page = app.windows().find(p => p.url().startsWith('peko-app://app/'));
            await page.evaluate(() => {setTimeout(()=>{void window.peko.invoke('window_action',{action:'exit'}).catch(()=>{});},0);});
        }
        else
            await app.evaluate(({app})=>{setImmediate(()=>app.quit());});
        const exitCode = await exited;
        assert.equal(exitCode, 0);
        report.runs.push({ scenario, exitCode, elapsedMs: Date.now() - before });
        app = undefined;
    }
    report.errors = existsSync(errorFile) ? readFileSync(errorFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    report.passed = report.errors.length === 0;
    if (!process.env.PEKO_EXIT_BASELINE)
        assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ passed: report.passed, runs: report.runs, mainErrors: report.errors.length }));
}
catch (error) {
    report.error = String(error);
    throw error;
}
finally {
    if(app&&app.process().exitCode===null)await app.close();
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
}
