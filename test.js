'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { satisfies } = require('./semver.js');
const { check } = require('./lockdrift.js');

test('caret ranges', () => {
  assert.strictEqual(satisfies('1.4.2', '^1.2.0'), true);
  assert.strictEqual(satisfies('2.0.0', '^1.2.0'), false);
  assert.strictEqual(satisfies('0.2.5', '^0.2.1'), true);
  assert.strictEqual(satisfies('0.3.0', '^0.2.1'), false);
  assert.strictEqual(satisfies('0.0.4', '^0.0.3'), false);
  assert.strictEqual(satisfies('1.9.0', '^1'), true);
});
test('tilde ranges', () => {
  assert.strictEqual(satisfies('1.2.9', '~1.2.3'), true);
  assert.strictEqual(satisfies('1.3.0', '~1.2.3'), false);
  assert.strictEqual(satisfies('1.9.0', '~1'), true);
});
test('comparators, x-ranges, hyphen, or', () => {
  assert.strictEqual(satisfies('3.1.0', '>=3 <4'), true);
  assert.strictEqual(satisfies('4.0.0', '>=3 <4'), false);
  assert.strictEqual(satisfies('1.2.7', '1.2.x'), true);
  assert.strictEqual(satisfies('1.3.0', '1.2.x'), false);
  assert.strictEqual(satisfies('2.5.0', '1.0.0 - 2'), true);
  assert.strictEqual(satisfies('3.0.0', '1.0.0 - 2'), false);
  assert.strictEqual(satisfies('5.0.0', '^3 || ^5'), true);
  assert.strictEqual(satisfies('4.0.0', '^3 || ^5'), false);
  assert.strictEqual(satisfies('9.9.9', '*'), true);
  assert.strictEqual(satisfies('1.0.0', '>1.0'), false);
  assert.strictEqual(satisfies('1.1.0', '>1.0'), true);
});
test('prereleases only match when asked for', () => {
  assert.strictEqual(satisfies('2.0.0-beta.1', '^1.0.0'), false);
  assert.strictEqual(satisfies('2.0.0-beta.2', '>=2.0.0-beta.1'), true);
  assert.strictEqual(satisfies('1.5.0-rc.1', '^1.0.0'), false);
});
test('ranges we do not understand give null, not a false alarm', () => {
  assert.strictEqual(satisfies('1.0.0', 'github:user/repo'), null);
  assert.strictEqual(satisfies('1.0.0', 'file:../x'), null);
  assert.strictEqual(satisfies('1.0.0', 'latest'), true);
});

const lockV3 = (root, pk) => ({ lockfileVersion: 3, packages: Object.assign({ '': root }, pk) });

test('a clean project has no problems', () => {
  const pkg = { dependencies: { a: '^1.0.0' }, devDependencies: { b: '~2.1.0' } };
  const lock = lockV3({ dependencies: { a: '^1.0.0' }, devDependencies: { b: '~2.1.0' } },
    { 'node_modules/a': { version: '1.3.0' }, 'node_modules/b': { version: '2.1.4' } });
  assert.deepStrictEqual(check(pkg, lock), []);
});
test('finds missing, out of range, changed spec and removed deps', () => {
  const pkg = { dependencies: { a: '^2.0.0', c: '^1.0.0', d: '1.x' }, devDependencies: {} };
  const lock = lockV3({ dependencies: { a: '^1.0.0', d: '1.x' }, devDependencies: { gone: '^1.0.0' } },
    { 'node_modules/a': { version: '1.3.0' }, 'node_modules/d': { version: '1.2.0' } });
  const kinds = check(pkg, lock).map((p) => p.kind + ':' + p.name).sort();
  assert.deepStrictEqual(kinds, ['extra:gone', 'missing:c', 'range:a', 'spec:a']);
});
test('lockfile v1 is understood', () => {
  const pkg = { dependencies: { a: '^1.0.0', b: '^1.0.0' } };
  const lock = { lockfileVersion: 1, dependencies: { a: { version: '1.0.5' } } };
  assert.deepStrictEqual(check(pkg, lock).map((p) => p.kind + ':' + p.name), ['missing:b']);
});

test('CLI exit codes and output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { a: '^2.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lockV3({ dependencies: { a: '^2.0.0' } }, { 'node_modules/a': { version: '2.1.0' } })));
  const ok = spawnSync('node', [path.join(__dirname, 'lockdrift.js'), dir], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { a: '^3.0.0' } }));
  const bad = spawnSync('node', [path.join(__dirname, 'lockdrift.js'), dir], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /range\s+a/);
  assert.strictEqual(spawnSync('node', [path.join(__dirname, 'lockdrift.js'), path.join(dir, 'nope')]).status, 2);
});

test('--json prints the problems and keeps the exit code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { a: '^3.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lockV3({ dependencies: { a: '^3.0.0' } }, { 'node_modules/a': { version: '2.1.0' } })));
  const r = spawnSync('node', [path.join(__dirname, 'lockdrift.js'), dir, '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(JSON.parse(r.stdout).map((p) => p.kind), ['range']);
});

test('npm-shrinkwrap.json is used when there is no package-lock.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { a: '^1.0.0' } }));
  fs.writeFileSync(path.join(dir, 'npm-shrinkwrap.json'), JSON.stringify(lockV3({ dependencies: { a: '^1.0.0' } }, { 'node_modules/a': { version: '1.0.0' } })));
  assert.strictEqual(spawnSync('node', [path.join(__dirname, 'lockdrift.js'), dir]).status, 0);
});
