'use strict';
// Regressionstest: hvert referencetag i tests/cases beregnes med koden i index.html og
// sammenlignes med facit i tests/snapshots. Facit opdateres bevidst med `npm run test:update`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./load');

const CASES_DIR = path.join(__dirname, 'cases');
const SNAP_DIR = path.join(__dirname, 'snapshots');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const TIMESTAMP = '2000-01-01T00:00:00.000';

const { TR, WD, LIB } = load();

// tal afrundes til 6 decimaler, så facit ikke afhænger af afrundingsstøj i sidste ciffer
function round(v) {
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v);
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  }
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = round(v[k]); });
    return o;
  }
  return v;
}

function countBy(list, key) {
  const o = {};
  list.forEach((x) => { o[x[key]] = (o[x[key]] || 0) + 1; });
  return o;
}

function memberLength(m) {
  return Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]);
}

function elementCounts(xml) {
  const o = {};
  const re = /<([a-z_]+)[\s/>]/g;
  let m;
  while ((m = re.exec(xml))) o[m[1]] = (o[m[1]] || 0) + 1;
  return Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
}

function compute(spec) {
  const params = Object.assign({}, TR.DEFAULTS, spec.params);
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  assert.deepEqual(geom.errors, [], 'Geometrien giver fejl');
  const loads0 = TR.computeLoads(geom);
  assert.deepEqual(loads0.errors, [], 'Lasterne giver fejl');

  // som knappen "Brug forslagene" på siden: de foreslåede kombinationer lægges i parametrene
  let proposed = null;
  if (spec.proposeCombos) {
    proposed = TR.proposeCombos(loads0, spec.proposeCombos);
    params.combos = TR.normCombos(proposed);
  }
  const g = spec.proposeCombos ? TR.computeGeometry(params) : geom;
  const loads = spec.proposeCombos ? TR.computeLoads(g) : loads0;
  assert.deepEqual(loads.comboErrors || [], [], 'Lastkombinationerne giver fejl');

  let guid = 0;
  const xml = TR.buildStruxml(params, LIB, {
    geometry: g, loads,
    guid: () => '00000000-0000-4000-8000-' + String(++guid).padStart(12, '0'),
    timestamp: TIMESTAMP
  });

  const groups = {};
  g.members.forEach((m) => {
    const s = groups[m.group] || (groups[m.group] = { count: 0, length: 0 });
    s.count++;
    s.length += memberLength(m);
  });
  const wd = WD.compute(g, loads, TR);

  const summary = round({
    version: TR.VERSION,
    geometry: {
      info: g.info,
      warnings: g.warnings,
      braceErrors: g.braceErrors,
      members: groups,
      supports: g.supports.length,
      covers: g.covers.length
    },
    quantities: TR.quantities(g, LIB),
    loads: {
      warnings: loads.warnings,
      panels: loads.panels.length,
      totalPanelArea: loads.panels.reduce((a, p) => a + p.area, 0),
      cases: loads.cases.map((c) => ({
        key: c.key, name: c.name, type: c.type, duration: c.duration,
        loads: countBy(c.loads, 'kind'), F: c.F
      })),
      dead: loads.dead, snow: loads.snow, wind: loads.wind, press: loads.press, temp: loads.temp, walk: loads.walk,
      combos: (loads.combos || []).map((c) => ({
        name: c.name, type: c.type, ok: c.ok, export: c.export,
        factors: c.items.reduce((a, it) => { a[it.key] = it.gamma; return a; }, {}), F: c.F
      }))
    },
    proposedCombos: proposed,
    windDoc: wd && {
      model: wd.model, qp: wd.qp, e: wd.e, c: wd.c, cpi: wd.cpi,
      cpeA: wd.cpeA, cpeB: wd.cpeB, cpeC: wd.cpeC, cpeConst: wd.cpeConst,
      nPanels: wd.nPanels, ApTotal: wd.ApTotal,
      zones: wd.zones.map((z) => ({ key: z.key, label: z.label, cpe0: z.cpe0, cpe1: z.cpe1, w0: z.w0, w1: z.w1 })),
      dirs: wd.dirs.map((d) => ({ deg: d.deg, name: d.name, panels: d.rows.length, F: d.Fm, caseF: d.caseF }))
    },
    struxml: {
      sha256: crypto.createHash('sha256').update(xml).digest('hex'),
      lines: xml.split('\n').length,
      elements: elementCounts(xml)
    }
  });
  return { summary, xml, windText: wd ? WD.text(wd) : null };
}

// første forskel mellem to StruXML-filer, så en fejl siger, hvor filen har ændret sig
function xmlDiff(oldXml, newXml) {
  const a = oldXml.split('\n'), b = newXml.split('\n');
  let first = -1, changed = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { changed++; if (first < 0) first = i; }
  }
  if (first < 0) return null;
  const cut = (s) => (s === undefined ? '(ingen linje)' : s.trim().slice(0, 300));
  return 'StruXML er ændret: ' + changed + ' linjer er forskellige (facit ' + a.length + ' linjer, nu ' + b.length + ').\n' +
    'Første forskel i linje ' + (first + 1) + ':\n  facit: ' + cut(a[first]) + '\n  nu:    ' + cut(b[first]);
}

const caseFiles = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
if (UPDATE) fs.mkdirSync(SNAP_DIR, { recursive: true });

for (const file of caseFiles) {
  const name = file.replace(/\.json$/, '');
  const spec = JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8'));
  const summaryPath = path.join(SNAP_DIR, name + '.json');
  const xmlPath = path.join(SNAP_DIR, name + '.struxml.gz');
  const windPath = path.join(SNAP_DIR, name + '.vind.txt');

  test(name + ': ' + spec.description, () => {
    const { summary, xml, windText } = compute(spec);

    if (UPDATE) {
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
      if (windText !== null) fs.writeFileSync(windPath, windText);
      else if (fs.existsSync(windPath)) fs.unlinkSync(windPath);
      // gzip-filen skrives kun om, når indholdet er ændret, så den ikke skifter uden grund
      const old = fs.existsSync(xmlPath) ? zlib.gunzipSync(fs.readFileSync(xmlPath)).toString('utf8') : null;
      if (old !== xml) fs.writeFileSync(xmlPath, zlib.gzipSync(xml, { level: 9 }));
      return;
    }

    assert.ok(fs.existsSync(summaryPath), 'Facit mangler for ' + name + '. Kør `npm run test:update`.');
    const expected = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const { struxml: expXml, ...expRest } = expected;
    const { struxml: gotXml, ...gotRest } = summary;
    assert.deepStrictEqual(gotRest, expRest, 'Geometri, mængder eller laster afviger fra facit');

    if (windText !== null || fs.existsSync(windPath)) {
      assert.ok(fs.existsSync(windPath), 'Facit for vinddokumentationen mangler. Kør `npm run test:update`.');
      assert.equal(windText, fs.readFileSync(windPath, 'utf8'), 'Vinddokumentationen afviger fra facit');
    }

    const oldXml = zlib.gunzipSync(fs.readFileSync(xmlPath)).toString('utf8');
    const diff = xmlDiff(oldXml, xml);
    if (diff) assert.fail(diff);
    assert.deepStrictEqual(gotXml, expXml, 'StruXML-oversigten afviger fra facit');
  });
}

// liggende fladstål skrives som stående med stangen drejet 90°: samme stang i rummet,
// men med den stærke akse om lokal y, så FEM-Designs ståldimensionering kan regne den
test('liggende fladstål eksporteres som stående tværsnit med drejet lokal y', () => {
  const params = Object.assign({}, TR.DEFAULTS, { profEdge: 'FL|200*25', profBrace: 'FL|100*10' });
  params.combos = TR.normCombos(params.combos);
  const g = TR.computeGeometry(params);
  const xml = TR.buildStruxml(params, LIB, { geometry: g });
  assert.ok(!/name="Fladstål, liggende/.test(xml), 'Liggende fladstål må ikke stå i filen');
  assert.match(xml, /name="Fladstål, stående, 200x25"/);
  assert.match(xml, /name="Fladstål, stående, 100x10"/);
  g.members.filter((m) => m.group === 'edge').forEach((m) => {
    const bar = new RegExp('<bar name="' + m.name.replace(/\./g, '\\.') + '"[\\s\\S]*?<local-y x="([^"]+)" y="([^"]+)" z="([^"]+)"').exec(xml);
    assert.ok(bar, 'Fandt ikke ' + m.name);
    const ly = bar.slice(1).map(Number);
    const x = [0, 1, 2].map((i) => m.end[i] - m.start[i]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(dot(ly, m.localY)) < 1e-9, 'Lokal y skal stå vinkelret på modellens lokale y');
    assert.ok(Math.abs(dot(ly, x)) < 1e-6, 'Lokal y skal stå vinkelret på stangen');
  });
});

// udvekslingsringe, som sektionsspærene går igennem, deles ved sektionsspæret; halvdelene har charnier mod det
// gennemgående sektionsspær og samme lokale y som den udelte korde. Den inderste ring, hvor sektionsspærene ender, er udelt.
test('udvekslinger deles ved sektionsspærene med charnier', () => {
  const params = Object.assign({}, TR.DEFAULTS, { secRing: 3, covers: 'all' });
  params.combos = TR.normCombos(params.combos);
  const g = TR.computeGeometry(params);
  assert.deepEqual(g.errors, []);
  const n = params.numRadial, udv = (k) => g.members.filter((m) => m.group === 'udv' && m.ringNo === k);
  assert.equal(udv(1).length, n, 'Ring 1 ligger inden for sektionsspærene og deles ikke');
  assert.equal(udv(2).length, n, 'Ring 2 er sektionsspærenes inderste ring og deles ikke');
  [3, 4].forEach((k) => {
    const ms = udv(k);
    assert.equal(ms.length, 2 * n, 'Ring ' + k + ' deles ved sektionsspærene');
    ms.forEach((m) => {
      const atSec = m.half === 0 ? m.end : m.start;
      const sec = g.members.filter((s) => s.group === 'sec' && Math.hypot(...[0, 1, 2].map((i) => s.end[i] - atSec[i])) < 1e-9);
      assert.equal(sec.length, 1, m.name + ' skal ende, hvor et sektionsspær går igennem');
      assert.equal(m.half === 0 ? m.connEnd : m.connStart, 'hinged', m.name + ' skal have charnier mod sektionsspæret');
      assert.equal(m.half === 0 ? m.connStart : m.connEnd, params.connUdv);
    });
  });
  g.members.filter((s) => s.group === 'sec').forEach((s) => {
    if (s.seg > 0) assert.equal(s.connStart, 'rigid', 'Sektionsspæret er gennemgående');
  });
  // fladerne i et sektionsspærfelt bæres kun af den halve udveksling langs deres kant
  g.covers.filter((c) => c.half !== undefined).forEach((c) => {
    c.supports.filter((m) => m.group === 'udv' && m.half !== undefined).forEach((m) => assert.equal(m.half, c.half, c.name));
  });
  const xml = TR.buildStruxml(params, LIB, { geometry: g });
  const bar = /<bar name="UDV3\.1"[\s\S]*?<\/bar>/.exec(xml)[0];
  const conn = bar.match(/<connectivity [^>]*>/g);
  assert.equal(conn[1], '<connectivity m_x="true" m_y="true" m_z="true" r_x="true" r_y="false" r_z="false"/>');
});

// svejst T af fladstål (flange 300x25, krop 400x6 nedad) på kantringen: brugertværsnit med origo i tyngdepunktet,
// flangen mod lokal z (opad) som bibliotekets T-profiler, fremstillet som svejst og uden ekscentricitet
test('svejst T-profil på kantringen eksporteres som brugertværsnit med flangen opad', () => {
  const s = TR.findSection(LIB, 'TS|300*25+400*6');
  assert.ok(s, 'Fandt ikke det svejste T-profil');
  assert.ok(Math.abs(s.area - (0.3 * 0.025 + 0.4 * 0.006)) < 1e-12);
  const pts = TR.sectionOutline(s.xml)[0];
  const ys = pts.map((q) => q[1]);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.425) < 1e-9, 'Højden skal være 425 mm');
  // tyngdepunktet i origo: flangens overside 64,0 mm over og kroppens underkant 361,0 mm under
  assert.ok(Math.abs(Math.max(...ys) - 0.064015152) < 1e-8);
  // flangen (300 bred) ligger øverst
  const wide = pts.filter((q) => Math.abs(Math.abs(q[0]) - 0.15) < 1e-9).map((q) => q[1]);
  assert.ok(Math.min(...wide) > 0, 'Flangen skal ligge over tyngdepunktet');

  const params = Object.assign({}, TR.DEFAULTS, { profEdge: 'TS|300*25+400*6' });
  params.combos = TR.normCombos(params.combos);
  const g = TR.computeGeometry(params);
  const xml = TR.buildStruxml(params, LIB, { geometry: g });
  assert.equal((xml.match(/name="Svejst T, 300x25\+400x6"/g) || []).length, 1, 'Tværsnittet skal stå én gang i filen');
  const edges = g.members.filter((m) => m.group === 'edge');
  assert.ok(edges.length > 0);
  edges.forEach((m) => {
    const bar = new RegExp('<bar name="' + m.name.replace(/\./g, '\\.') + '"[\\s\\S]*?made="([^"]+)"[\\s\\S]*?<local-y x="([^"]+)" y="([^"]+)" z="([^"]+)"[\\s\\S]*?</bar>').exec(xml);
    assert.ok(bar, 'Fandt ikke ' + m.name);
    assert.equal(bar[1], 'welded');
    const ly = bar.slice(2, 5).map(Number);
    ly.forEach((v, i) => assert.ok(Math.abs(v - m.localY[i]) < 1e-6, 'Lokal y skal være modellens'));
    // lokal z = x × y skal pege opad, så flangen ligger øverst
    const x = [0, 1, 2].map((i) => m.end[i] - m.start[i]);
    const z2 = x[0] * ly[1] - x[1] * ly[0];
    assert.ok(z2 > 0, 'Lokal z skal pege opad');
    assert.ok(!/<analytical x="(?!0")/.test(bar[0]), 'Ingen ekscentricitet');
  });
});
