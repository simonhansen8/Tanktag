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
      rot: loads.rot && {
        F: loads.rot.F, dir: loads.rot.dir, Mz: loads.rot.Mz,
        nodes: loads.rot.nodes.map((x) => ({ name: x.name, pos: x.pos, dir: x.dir, members: x.members, mz: x.mz }))
      },
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
  const ld = WD.loads.compute(g, loads, TR);
  return { summary, xml, windText: wd ? WD.text(wd) : null, loadText: ld ? WD.loads.text(ld) : null };
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
  const loadPath = path.join(SNAP_DIR, name + '.laster.txt');

  test(name + ': ' + spec.description, () => {
    const { summary, xml, windText, loadText } = compute(spec);

    if (UPDATE) {
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
      if (windText !== null) fs.writeFileSync(windPath, windText);
      else if (fs.existsSync(windPath)) fs.unlinkSync(windPath);
      if (loadText !== null) fs.writeFileSync(loadPath, loadText);
      else if (fs.existsSync(loadPath)) fs.unlinkSync(loadPath);
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
    if (loadText !== null || fs.existsSync(loadPath)) {
      assert.ok(fs.existsSync(loadPath), 'Facit for lastdokumentationen mangler. Kør `npm run test:update`.');
      assert.equal(loadText, fs.readFileSync(loadPath, 'utf8'), 'Lastdokumentationen afviger fra facit');
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

// svejst C af fladstål (flanger 500x15, krop 330x10) på den midterste ringbjælke: tværsnitsværdierne skal svare til
// FEM-Designs (A = 18300 mm², Iy = 476572500 mm⁴, Iz = 474890205 mm⁴), orienteret som bibliotekets U-profiler
// med origo i tyngdepunktet, og ringen drejet 180° om stangaksen, så flangerne peger udad
test('svejst C-profil på ringbjælken har FEM-Designs tværsnitsværdier og flangerne udad', () => {
  const s = TR.findSection(LIB, 'CS|500*15+330*10');
  assert.ok(s, 'Fandt ikke det svejste C-profil');
  const P = TR.sectionOutline(s.xml)[0].map((q) => q.map((v) => v * 1000));
  let A = 0, Sy = 0, Sz = 0, Iy = 0, Iz = 0;
  P.forEach((a, i) => {
    const b = P[(i + 1) % P.length], c = a[0] * b[1] - b[0] * a[1];
    A += c / 2; Sy += (a[0] + b[0]) * c / 6; Sz += (a[1] + b[1]) * c / 6;
    Iy += (a[1] * a[1] + a[1] * b[1] + b[1] * b[1]) * c / 12;
    Iz += (a[0] * a[0] + a[0] * b[0] + b[0] * b[0]) * c / 12;
  });
  assert.ok(Math.abs(A - 18300) < 1e-6, 'A = ' + A);
  assert.ok(Math.abs(Sy / A) < 1e-6 && Math.abs(Sz / A) < 1e-6, 'Origo skal ligge i tyngdepunktet');
  assert.ok(Math.abs(Iy - 476572500) < 1, 'Iy = ' + Iy);
  assert.ok(Math.abs(Iz - 474890205) < 1, 'Iz = ' + Iz);
  // kroppen (bagsiden) ved negativ lokal y og flangerne mod +lokal y som bibliotekets U-profiler
  const xs = P.map((q) => q[0]);
  assert.ok(Math.abs(Math.min(...xs) + 205.82) < 0.01 && Math.abs(Math.max(...xs) - 294.18) < 0.01);

  const params = Object.assign({}, TR.DEFAULTS, { profRing: 'CS|500*15+330*10' });
  params.combos = TR.normCombos(params.combos);
  const g = TR.computeGeometry(params);
  const xml = TR.buildStruxml(params, LIB, { geometry: g });
  assert.equal((xml.match(/name="Svejst C, 500x15\+330x10"/g) || []).length, 1, 'Tværsnittet skal stå én gang i filen');
  const rings = g.members.filter((m) => m.group === 'ring');
  assert.ok(rings.length > 0);
  rings.forEach((m) => {
    const bar = new RegExp('<bar name="' + m.name.replace(/\./g, '\\.') + '"[\\s\\S]*?made="([^"]+)"[\\s\\S]*?<local-y x="([^"]+)" y="([^"]+)" z="([^"]+)"[\\s\\S]*?</bar>').exec(xml);
    assert.ok(bar, 'Fandt ikke ' + m.name);
    assert.equal(bar[1], 'welded');
    const ly = bar.slice(2, 5).map(Number);
    // lokal y (flangerne) peger væk fra centrum
    const mid = [0, 1].map((i) => (m.start[i] + m.end[i]) / 2);
    assert.ok(ly[0] * mid[0] + ly[1] * mid[1] > 0, 'Flangerne skal pege udad');
    assert.ok(!/<analytical x="(?!0")/.test(bar[0]), 'Ingen ekscentricitet');
  });
  // radialbjælkerne er uændrede
  const base = TR.computeGeometry(Object.assign({}, TR.DEFAULTS, { combos: TR.normCombos(TR.DEFAULTS.combos) }));
  assert.deepEqual(g.members.filter((m) => m.group !== 'ring').map((m) => m.localY),
    base.members.filter((m) => m.group !== 'ring').map((m) => m.localY));
});

test('vindgitteret skrives med knudenavnene fra FEM-Design, og den gamle form "22:S" læses stadig', () => {
  assert.equal(TR.modernBracing('23:S-22:3; 3+:2+ - 1:r; KS.4-K2.3'), 'KS.23-K3.22; K2ML.3 - KR.1; KS.4-K2.3');
  const ny = TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS)));
  const gl = TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS,
    { bracing: '23:S-22:3; 22:S-23:3; 22:3-23:2; 23:2-22:1; 23:1-22:2; 22:2-23:3' })));
  assert.equal(gl.params.bracing, TR.DEFAULTS.bracing);
  assert.deepEqual(gl.braceErrors, []);
  assert.deepEqual(gl.members.map((m) => m.name + m.start + m.end), ny.members.map((m) => m.name + m.start + m.end));
  assert.equal(ny.info.brace.members, 18);
  // knudenavnet står i fejlbeskeden, som i FEM-Design
  const fejl = TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS, { bracing: 'ks.1-k2m.1; KSL.1-K1.2' })));
  assert.deepEqual(fejl.braceErrors, ['Vindgitter: "KSL.1" peger ud over svøbet.']);
});

test('vindgitteret kun i træk får den tilladte trykkraft som sprød grænse, og 0 er standard', () => {
  const xmlFor = (o) => {
    const params = TR.normalizeParams(Object.assign({}, TR.DEFAULTS, o));
    return TR.buildStruxml(params, LIB, { geometry: TR.computeGeometry(params) });
  };
  const limits = (xml) => (xml.match(/<limit_force value="[^"]*"\/>/g) || []);
  assert.equal(limits(xmlFor({})).length, 0);
  const nul = limits(xmlFor({ braceTensionOnly: true }));
  assert.equal(nul.length, 18 * 9);
  assert.ok(nul.every((x) => x === '<limit_force value="0"/>'));
  const fem = limits(xmlFor({ braceTensionOnly: true, braceCompLimit: '12.5' }));
  assert.equal(fem.length, 18 * 9);
  assert.ok(fem.every((x) => x === '<limit_force value="12.5"/>'));
  const neg = TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS, { braceTensionOnly: true, braceCompLimit: -1 })));
  assert.deepEqual(neg.braceErrors, ['Vindgitter: den tilladte trykkraft skal være 0 eller større.']);
});

test('sne på kuppeltag følger 5.3.5: μ3 = 0,2 + 10 h/b og trekanterne i fig. 5.6 i hvert snit gennem toppen', () => {
  const p = TR.normalizeParams(Object.assign({}, TR.DEFAULTS, { asymDir: 30 }));
  const L = TR.computeLoads(TR.computeGeometry(p));
  assert.deepEqual(L.errors, []);
  const sd = L.snow.dome, R = p.tankDiameter / 2;
  const h = p.domeRadius - Math.sqrt(p.domeRadius ** 2 - R ** 2);
  assert.ok(Math.abs(sd.h - h) < 0.02, 'h er kuplens rejsning');
  assert.ok(Math.abs(sd.mu3 - (0.2 + 10 * sd.h / (2 * R))) < 1e-12);
  assert.equal(sd.ls, 2 * R);
  const Ap = L.panels.reduce((a, pp) => a + pp.areaProj, 0);
  const byKey = Object.fromEntries(L.cases.map((c) => [c.key, c]));
  const share = (k) => -byKey[k].F[2] / (L.snow.s0 * Ap);
  // over kuplens areal er middelværdien (½μ3 + μ3)/4 som i snittet, og ingen flade over toppunktet
  assert.ok(Math.abs(share('snowUniform') - 0.8) < 1e-9);
  assert.ok(Math.abs(share('snowAsym') / (0.375 * sd.mu3) - 1) < 0.02);
  assert.ok(Math.max(...byKey.snowAsym.mu) <= sd.mu3 + 1e-12);
  // fladerne langs skillelinjen har sne; profilet er kun 0 ved toppen og ved kanten
  const ad = p.asymDir * Math.PI / 180;
  const langs = L.panels.map((pp, i) => i).filter((i) => {
    const [x, y] = L.panels[i].centroid, r = Math.hypot(x, y);
    return Math.abs(x * Math.cos(ad) + y * Math.sin(ad)) < 1.5 && r > 2 && r < 0.8 * R;
  });
  assert.ok(langs.length >= 4);
  langs.forEach((i) => assert.ok(byKey.snowAsym.mu[i] > 0.2, L.panels[i].cover.name + ' har sne'));
  // læsiden (mod θ) bærer to tredjedele
  const lee = L.panels.reduce((a, pp, i) => a + ((pp.centroid[0] * Math.cos(ad) + pp.centroid[1] * Math.sin(ad) > 0) ? byKey.snowAsym.mu[i] * pp.areaProj : 0), 0);
  assert.ok(lee > 0.6 * -byKey.snowAsym.F[2] / L.snow.s0, 'mest på læsiden');
});

test('halvt tag på kuppel: μ1 = 0,8 på læsiden og μ på luvsiden (tomt felt = 0)', () => {
  const run = (o) => {
    const p = TR.normalizeParams(Object.assign({}, TR.DEFAULTS, { asymDir: 20 }, o));
    const L = TR.computeLoads(TR.computeGeometry(p));
    assert.deepEqual(L.errors, []);
    const c = L.cases.find((x) => x.key === 'snowHalf');
    const Ap = L.panels.reduce((a, pp) => a + pp.areaProj, 0);
    return { L, c, share: c ? -c.F[2] / (L.snow.s0 * Ap) : 0 };
  };
  const nul = run({});
  assert.equal(nul.c.name, 'Sne, halvt tag');
  assert.ok(Math.abs(nul.share - 0.4) < 0.01, 'halvdelen af taget med 0,8');
  assert.ok(Math.abs(nul.L.snow.dome.half.ApLee / (nul.L.snow.dome.half.ApLee + nul.L.snow.dome.half.ApWind) - 0.5) < 0.01);
  assert.ok(Math.abs(run({ snowAsymMu: '0,2' }).share - 0.5) < 0.01);
  // slås fra med feltet, og kegletaget har det ikke
  assert.ok(!run({ snowHalf: false }).L.cases.some((x) => x.key === 'snowHalf'));
  const kegle = TR.computeLoads(TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS, { roofType: 'cone' }))));
  assert.ok(!kegle.cases.some((x) => x.key === 'snowHalf'));
});

test('kun lodret med valgte knuder: globale retninger og rotationer, fejl og advarsler', () => {
  // RB.1 ved 0°, 24 radialbjælker: KS.1 ved 0°, KS.7 ved 90°, KS.13 ved 180° og KS.19 ved 270°
  const geo = (o) => TR.computeGeometry(TR.normalizeParams(Object.assign({}, TR.DEFAULTS,
    { support: 'vertical', holdMode: 'nodes', rotationDeg: 0, secAxes: false }, o)));
  const g = geo({ holds: [{ nodes: 'KS.1', x: true }, { nodes: 'ks.7, KS.13', y: true }, { nodes: 'KSM.4', rx: true }] });
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.holdErrors, []);
  assert.deepEqual(g.warnings.filter((w) => /fastholdelser|fastholdt vandret/.test(w)), []);
  const by = Object.fromEntries(g.supports.map((s) => [s.node, s]));
  assert.ok(Math.abs(by['KS.7'].pos[0]) < 1e-9 && by['KS.7'].pos[1] > 0, 'KS.7 ved 90°');
  assert.ok(by['KS.1'].motions.x > 0 && by['KS.1'].motions.y === 0 && by['KS.1'].motions.z > 0);
  assert.ok(by['KS.13'].motions.x === 0 && by['KS.13'].motions.y > 0);
  assert.ok(by['KSM.4'].motions.x === 0 && by['KSM.4'].motions.y === 0 && by['KSM.4'].rotations.x > 0 && by['KSM.4'].rotations.z === 0);
  assert.ok(by['KS.2'].motions.x === 0 && by['KS.2'].motions.y === 0 && by['KS.2'].motions.z > 0);
  // globalt system ved de valgte knuder, radialt ved resten
  assert.deepEqual(by['KS.7'].localX, [1, 0, 0]);
  assert.deepEqual(by['KSM.4'].localY, [0, 1, 0]);
  assert.notDeepEqual(by['KS.2'].localX, [1, 0, 0]);
  assert.deepEqual(g.info.hold.map((h) => h.name + ' ' + h.dir), ['KS.1 X', 'KS.7 Y', 'KS.13 Y', 'KSM.4 rot X']);
  // samme tre fastholdelser som den automatiske: statisk bestemt, så svøbets udvidelse ikke lægges ind
  assert.equal(g.info.holdDeterminate, true);
  assert.equal(TR.computeLoads(g).temp.determinate, true);
  const xml = TR.buildStruxml(g.params, LIB, { geometry: g });
  assert.match(xml, /name="SS\.4">[\s\S]*?<rotations x_neg="10000000000"/);

  // en rotation om den lodrette akse låser også drejningen, men gør det statisk ubestemt
  const gz = geo({ holds: [{ nodes: 'KS.1', x: true, rz: true }, { nodes: 'KS.7 KS.13', y: true }] });
  assert.ok(!gz.warnings.some((w) => /fastholdelser/.test(w)));
  assert.equal(gz.info.holdDeterminate, false);
  // X og Y uden mere kan dreje; X ved 0° og 180° på samme linje kan forskydes og dreje
  assert.ok(geo({ holds: [{ nodes: 'KS.1', x: true }, { nodes: 'KS.7', y: true }] }).warnings.some((w) => /kan dreje om den lodrette akse/.test(w)));
  assert.ok(geo({ holds: [{ nodes: 'KS.1 KS.13', x: true }] }).warnings.some((w) => /kan forskydes eller dreje/.test(w)));
  assert.ok(geo({ holds: [] }).warnings.some((w) => /Ingen understøtninger er fastholdt vandret/.test(w)));
  // X og Y ved fire knuder: statisk ubestemt, så svøbets udvidelse lægges ind som flytning i X og Y
  const g4 = geo({ holds: [{ nodes: 'KS.1; KS.7; KS.13; KS.19', x: true, y: true }, { nodes: 'KS.4', x: true, y: true }] });
  assert.equal(g4.info.holdDeterminate, false);
  const L4 = TR.computeLoads(g4), tc = L4.cases.find((c) => c.key === 'temp');
  assert.equal(L4.temp.motions, 5);
  const mv = tc.loads.filter((l) => l.kind === 'motion');
  assert.equal(mv.length, 6);   // én ved hver af de fire ved akserne, to ved KS.4 (45°)
  const at4 = mv.filter((l) => Math.abs(l.pos[0] - by['KS.4'].pos[0]) < 1e-9 && Math.abs(l.pos[1] - by['KS.4'].pos[1]) < 1e-9);
  assert.equal(at4.length, 2);
  assert.ok(Math.abs(Math.hypot(at4[0].val, at4[1].val) - L4.temp.u) < 1e-12, 'samlet flytning = svøbets radiale udvidelse');

  // ukendte knuder og rækker uden retning er fejl, som stopper eksporten
  const bad = geo({ holds: [{ nodes: 'KS.99', x: true }, { nodes: 'KS.2' }, { nodes: '', y: true }] });
  assert.equal(bad.holdErrors.length, 3);
  assert.throws(() => TR.buildStruxml(bad.params, LIB, { geometry: bad }), /KS\.99/);
  assert.equal(geo({ secOn: false, holds: [{ nodes: 'KSM.1', x: true }] }).holdErrors.length, 1);

  // automatisk er uændret, og listen bruges kun ved holdMode 'nodes'
  const auto = geo({ holdMode: 'auto', holds: [{ nodes: 'KS.99', x: true }] });
  assert.deepEqual(auto.holdErrors, []);
  assert.equal(auto.info.hold.length, 3);
  assert.equal(auto.info.holdDeterminate, true);
});

// rotationsstivhed: vandrette punktlaster langs udvekslingerne, med i filen men aldrig i lastkombinationerne
test('rotationsstivhed ligger langs udvekslingen og er kun med i sin egen lastkombination', () => {
  const run = (o) => {
    const params = Object.assign({}, TR.DEFAULTS, { rotTestOn: true }, o);
    params.combos = TR.normCombos(params.combos);
    const g = TR.computeGeometry(params);
    return { params, g, L: TR.computeLoads(g) };
  };
  const tan = (pos) => { const r = Math.hypot(pos[0], pos[1]); return [-pos[1] / r, pos[0] / r, 0]; };
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

  // tangentielt: vinkelret på radius, midt mellem de to udvekslinger ved radialbjælken
  const { L: Lm } = run({ rotTestNodes: 'K2.1, K2.13', rotTestF: 10 });
  assert.deepEqual(Lm.errors, []);
  const cm = Lm.cases.find((c) => c.key === 'rotTest');
  assert.equal(cm.name, 'Rotationsstivhed');
  assert.equal(cm.loads.length, 2);
  cm.loads.forEach((l) => { assert.equal(l.kind, 'point'); assert.ok(close(l.dir, tan(l.pos))); assert.equal(l.val, 10); });
  assert.ok(cm.Fh < 1e-9, 'modstående knuder giver et rent moment');
  assert.ok(Math.abs(Lm.rot.Mz - 2 * 10 * Math.hypot(cm.loads[0].pos[0], cm.loads[0].pos[1])) < 1e-9);

  // langs bjælken mod og med uret: præcis langs den ene udveksling; negativ kraft vender retningen
  const one = (dir, F) => run({ rotTestNodes: 'K2.1', rotTestDir: dir, rotTestF: F }).L.rot.nodes[0];
  const ccw = one('ccw', 10), cw = one('cw', 10), neg = one('ccw', -10);
  assert.deepEqual(ccw.members, ['UDV2.1']);
  assert.deepEqual(cw.members, ['UDV2.24']);
  assert.ok(!close(ccw.dir, cw.dir));
  assert.ok(close(neg.dir, ccw.dir.map((v) => -v)));
  assert.ok(neg.mz < 0 && ccw.mz > 0);
  // midt på en udveksling er der kun én bjælke
  const mid = run({ rotTestNodes: 'K2M.1', rotTestDir: 'mean' }).L.rot.nodes[0];
  assert.deepEqual(mid.members, ['UDV2.1']);

  // forslag og egne kombinationer tager den ikke med; en faktor for den giver en advarsel
  const { params, g, L } = run({ rotTestNodes: 'K2.1', combos: [{ name: 'K1', type: 'ultimate_ordinary', f: { dead: '1', rotTest: '1,5' } }] });
  assert.ok(!TR.proposeCombos(L, {}).some((c) => 'rotTest' in c.f));
  assert.deepEqual(L.combos[0].items.map((it) => it.key), ['dead']);
  assert.ok(L.warnings.some((w) => /"Rotationsstivhed", som ikke kommer med i de almindelige/.test(w)));
  const xml = TR.buildStruxml(params, LIB, { geometry: g, loads: L });
  const lc = /<load_case type="static" duration_class="[^"]+" guid="([^"]+)"[^>]*name="Rotationsstivhed"/.exec(xml);
  assert.ok(lc, 'lasttilfældet står i filen');
  assert.equal((xml.match(new RegExp('<point_load load_case="' + lc[1] + '"', 'g')) || []).length, 1);
  // kun i sin egen kombination: faktor 1, anvendelse, karakteristisk
  const combosXml = xml.match(/<load_combination [\s\S]*?<\/load_combination>/g);
  const own = combosXml.filter((c) => c.includes(lc[1]));
  assert.equal(own.length, 1);
  assert.match(own[0], /name="Rotationsstivhed" type="serviceability_characteristic"/);
  assert.equal((own[0].match(/<load_case /g) || []).length, 1);
  assert.match(own[0], /gamma="1"/);
  // uden fluebenet er den ikke i nogen kombination
  const off = run({ rotTestNodes: 'K2.1', rotTestCombo: false });
  const xmlOff = TR.buildStruxml(off.params, LIB, { geometry: off.g, loads: off.L });
  const lcOff = /<load_case [^>]*guid="([^"]+)"[^>]*name="Rotationsstivhed"/.exec(xmlOff)[1];
  assert.ok(!(xmlOff.match(/<load_combination [\s\S]*?<\/load_combination>/g) || []).some((c) => c.includes(lcOff)));
  // en egen kombination med samme navn vinder, og der kommer en advarsel
  const clash = run({ rotTestNodes: 'K2.1', combos: [{ name: 'rotationsstivhed', type: 'ultimate_ordinary', f: { dead: '1' } }] }).L;
  assert.equal(clash.combos.filter((c) => c.auto).length, 0);
  assert.ok(clash.warnings.some((w) => /får ikke sin egen/.test(w)));

  // knuder uden udveksling og ukendte navne er fejl
  assert.equal(run({ rotTestNodes: 'K1L.1, KX.1' }).L.errors.length, 2);
  // ingen knuder: tomt lasttilfælde, så knuderne kan vælges i planen
  const empty = run({ rotTestNodes: '' }).L;
  assert.deepEqual(empty.errors, []);
  assert.equal(empty.cases.find((c) => c.key === 'rotTest').loads.length, 0);
});

// søjle- og kipningslængder: β for hvert stykke, eller med »hele« omregnet fra hele bjælkens længde til stykket
test('søjle- og kipningslængder skrives som buckling_data på radialbjælker og sektionsspær', () => {
  const params = Object.assign({}, TR.DEFAULTS, {
    bkRadialStiffFull: true, bkRadialWeak: '0,5', bkSecTop: 0.7, bkSecTopFull: true
  });
  params.combos = TR.normCombos(params.combos);
  const g = TR.computeGeometry(params);
  assert.deepEqual(g.errors, []);
  const len = (m) => Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]);
  const rb = g.members.filter((m) => m.group === 'radial' && m.index === 0);
  const sek = g.members.filter((m) => m.group === 'sec' && m.index === 0);
  assert.ok(rb.length > 1 && sek.length > 1, 'standardtaget har delte radialbjælker og sektionsspær');
  const rbFull = rb.reduce((a, m) => a + len(m), 0), sekFull = sek.reduce((a, m) => a + len(m), 0);
  rb.forEach((m) => {
    const b = TR.bucklingBetas(g.params, m);
    assert.ok(Math.abs(b[0] * len(m) - rbFull) < 1e-9, m.name + ': søjlelængden om stærk akse er hele bjælken');
    assert.deepEqual(b.slice(1), [0.5, 1, 1]);
  });
  sek.forEach((m) => {
    const b = TR.bucklingBetas(g.params, m);
    assert.ok(Math.abs(b[2] * len(m) - 0.7 * sekFull) < 1e-9, m.name + ': kipningslængden er 0,7 gange hele sektionsspæret');
    assert.deepEqual([b[0], b[1], b[3]], [1, 1, 1]);
  });
  // kun radialbjælker og sektionsspær får knæklængder
  g.members.filter((m) => m.group !== 'radial' && m.group !== 'sec').forEach((m) => assert.equal(TR.bucklingBetas(g.params, m), null));

  const xml = TR.buildStruxml(params, LIB, { geometry: g });
  const bars = xml.split('<bar ').slice(1);
  const rb11 = bars.find((b) => b.startsWith('name="RB1.1"'));
  assert.match(rb11, /<buckling_length type="flexural_stiff" beta="[\d.]+" sway="false">\s*<position start="0" end="1"\/>/);
  assert.match(rb11, /<buckling_length type="flexural_weak" beta="0.5" sway="false">/);
  assert.match(rb11, /<buckling_length type="pressured_flange" beta="1" load_position="top" continously_restrained="false">/);
  assert.match(rb11, /<buckling_length type="pressured_bottom_flange" beta="1" load_position="top" continously_restrained="false">/);
  // buckling_data ligger mellem eccentricity og end i bar_part
  assert.match(rb11, /<\/eccentricity>\s*<buckling_data>[\s\S]*<\/buckling_data>\s*<end\/>\s*<\/bar_part>/);
  assert.ok(!bars.find((b) => b.startsWith('name="RING.1"')).includes('buckling_data'));

  // β uden for FEM-Designs interval giver en fejl
  const bad = TR.computeGeometry(Object.assign({}, params, { bkRadialWeak: 0 }));
  assert.ok(bad.errors.some((e) => /Søjle, svag akse for radialbjælkerne/.test(e)));
});
