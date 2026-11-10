import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
const workflow=name=>parse(readFileSync(`.github/workflows/${name}.yml`,'utf8'));
test('release is manual and reuses the main-only Windows build with immutable source outputs',()=>{
  const release=workflow('release'),windows=workflow('windows');
  assert.deepEqual(Object.keys(release.on),['workflow_dispatch']);
  assert.equal(release.jobs.build.uses,'./.github/workflows/windows.yml');
  assert.equal(release.jobs.build.with['for-release'],true);
  assert.equal(windows.jobs.check.steps[0].with.ref,"${{ inputs.for-release && 'main' || github.sha }}");
  for(const output of ['commit','version'])assert.ok(windows.on.workflow_call.outputs[output].value);
  assert.equal(release.jobs.publish.needs,'build');
  assert.equal(release.permissions.contents,'read');
  assert.equal(release.jobs.publish.permissions.contents,'write');
});
test('release uploads to an exact-commit draft before publishing and preserves published versions',()=>{
  const steps=workflow('release').jobs.publish.steps;
  const draft=steps.findIndex(s=>s.id==='draft'),upload=steps.findIndex(s=>s.name==='Upload portable application'),publish=steps.findIndex(s=>s.name==='Publish completed release');
  assert.ok(draft<upload&&upload<publish);
  assert.match(steps[draft].with.script,/!release.draft \|\| release.target_commitish !== commit/);
  assert.match(steps[draft].with.script,/draft: true/);
  assert.match(steps[publish].with.script,/draft: false/);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const step of steps.filter(s=>s.uses==='actions/github-script@v7'))new AsyncFunction('github','context','core','require',step.with.script.replaceAll('${{ inputs.prerelease }}','true'));
});
