#!/usr/bin/env node
'use strict';
// lockdrift: find out why `npm ci` would refuse your package-lock.json,
// without installing anything or touching the network.
const fs = require('fs');
const path = require('path');
const { satisfies } = require('./semver.js');

const GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function lockedVersion(lock, name) {
  if (lock.packages) {
    const e = lock.packages['node_modules/' + name];
    return e ? e.version : undefined;
  }
  const e = lock.dependencies && lock.dependencies[name];
  return e ? e.version : undefined;
}

// Returns a list of { kind, name, group, detail }.
function check(pkg, lock) {
  const problems = [];
  const root = lock.packages && lock.packages[''];
  for (const g of GROUPS) {
    const want = pkg[g] || {};
    for (const name of Object.keys(want)) {
      const range = want[name];
      const have = lockedVersion(lock, name);
      if (have === undefined) {
        problems.push({ kind: 'missing', name, group: g, detail: 'not in the lockfile (package.json wants ' + range + ')' });
        continue;
      }
      const ok = satisfies(have, range);
      if (ok === false) problems.push({ kind: 'range', name, group: g, detail: 'lockfile has ' + have + ', package.json wants ' + range });
      if (root) {
        const recorded = (root[g] || {})[name];
        if (recorded !== undefined && recorded !== range) {
          problems.push({ kind: 'spec', name, group: g, detail: 'lockfile root recorded "' + recorded + '", package.json now says "' + range + '"' });
        }
      }
    }
    if (root) {
      for (const name of Object.keys(root[g] || {})) {
        if (!(name in want)) problems.push({ kind: 'extra', name, group: g, detail: 'still in the lockfile root but removed from package.json' });
      }
    }
  }
  return problems;
}

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(file + ': ' + e.message); }
}

function main(argv) {
  const dir = argv[0] || '.';
  const pkgFile = path.join(dir, 'package.json');
  const lockFile = path.join(dir, 'package-lock.json');
  if (!fs.existsSync(pkgFile)) { console.error('no package.json in ' + dir); return 2; }
  if (!fs.existsSync(lockFile)) { console.error('no package-lock.json in ' + dir); return 2; }
  const problems = check(load(pkgFile), load(lockFile));
  if (!problems.length) { console.log('lockfile matches package.json'); return 0; }
  for (const p of problems) console.log(p.kind.padEnd(8) + p.name + ' (' + p.group + '): ' + p.detail);
  console.log('\n' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + '. Run `npm install` to update the lockfile.');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { check, main };
