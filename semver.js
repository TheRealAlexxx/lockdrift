'use strict';
// Just enough semver to check "does this locked version satisfy this range".
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v).trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null } : null;
}

function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const pa = a.pre.split('.'), pb = b.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]), nb = /^\d+$/.test(pb[i]);
    if (na && nb) { if (+pa[i] !== +pb[i]) return +pa[i] < +pb[i] ? -1 : 1; }
    else if (na) return -1;
    else if (nb) return 1;
    else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// A partial like "1.2" or "1.x" -> { major, minor, patch } with nulls for wildcards.
function partial(s) {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(s);
  if (!m) return null;
  const n = (x) => (x === undefined || /[xX*]/.test(x) ? null : +x);
  return { major: n(m[1]), minor: n(m[2]), patch: n(m[3]), pre: m[4] || null };
}

function lowFrom(p) { return { major: p.major || 0, minor: p.minor || 0, patch: p.patch || 0, pre: p.pre }; }

// One comparator set (no ||) -> list of [op, version].
function comparators(set) {
  const out = [];
  const hy = /^(\S+)\s+-\s+(\S+)$/.exec(set.trim());
  if (hy) {
    const a = partial(hy[1]), b = partial(hy[2]);
    if (!a || !b) return null;
    out.push(['>=', lowFrom(a)]);
    if (b.minor === null) out.push(['<', { major: b.major + 1, minor: 0, patch: 0, pre: null }]);
    else if (b.patch === null) out.push(['<', { major: b.major, minor: b.minor + 1, patch: 0, pre: null }]);
    else out.push(['<=', lowFrom(b)]);
    return out;
  }
  const toks = set.trim().replace(/([<>=~^]+)\s+/g, '$1').split(/\s+/).filter(Boolean);
  for (const t of toks) {
    const m = /^(\^|~>?|>=|<=|>|<|=)?(.+)$/.exec(t);
    const op = m[1] || '=';
    const p = partial(m[2]);
    if (!p) return null;
    if (p.major === null) continue;                     // * matches anything
    const lo = lowFrom(p);
    if (op === '^') {
      out.push(['>=', lo]);
      let hi;
      if (p.major > 0 || p.minor === null) hi = { major: p.major + 1, minor: 0, patch: 0 };
      else if (p.minor > 0 || p.patch === null) hi = { major: 0, minor: p.minor + 1, patch: 0 };
      else hi = { major: 0, minor: 0, patch: p.patch + 1 };
      out.push(['<', Object.assign(hi, { pre: null })]);
    } else if (op[0] === '~') {
      out.push(['>=', lo]);
      out.push(['<', p.minor === null ? { major: p.major + 1, minor: 0, patch: 0, pre: null } : { major: p.major, minor: p.minor + 1, patch: 0, pre: null }]);
    } else if (op === '=') {
      if (p.minor === null) { out.push(['>=', lo]); out.push(['<', { major: p.major + 1, minor: 0, patch: 0, pre: null }]); }
      else if (p.patch === null) { out.push(['>=', lo]); out.push(['<', { major: p.major, minor: p.minor + 1, patch: 0, pre: null }]); }
      else out.push(['=', lo]);
    } else if (op === '>' && (p.minor === null || p.patch === null)) {
      out.push(['>=', p.minor === null ? { major: p.major + 1, minor: 0, patch: 0, pre: null } : { major: p.major, minor: p.minor + 1, patch: 0, pre: null }]);
    } else if (op === '<=' && (p.minor === null || p.patch === null)) {
      out.push(['<', p.minor === null ? { major: p.major + 1, minor: 0, patch: 0, pre: null } : { major: p.major, minor: p.minor + 1, patch: 0, pre: null }]);
    } else out.push([op, lo]);
  }
  return out;
}

// Returns true, false, or null when the range is not something we understand
// (git urls, tags, file: paths). Callers should skip null.
function satisfies(version, range) {
  const v = parse(version);
  if (!v) return null;
  const r = String(range).trim();
  if (r === '' || r === '*' || r === 'x' || r === 'latest') return true;
  let any = false;
  for (const set of r.split('||')) {
    const cs = comparators(set);
    if (cs === null) return null;
    const ok = cs.every(([op, w]) => {
      const c = cmp(v, w);
      return op === '>=' ? c >= 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : op === '<' ? c < 0 : c === 0;
    });
    // prereleases only match if some comparator has the same major.minor.patch with a prerelease
    const preOk = !v.pre || cs.some(([, w]) => w.pre && w.major === v.major && w.minor === v.minor && w.patch === v.patch);
    if (ok && preOk) any = true;
  }
  return any;
}

module.exports = { parse, cmp, satisfies };
