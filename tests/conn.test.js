'use strict';
// Samlinger: indlæsning af FEM-Designs stangkræfter og de dimensionerende tilfælde i knuderne.
// tests/fixtures/endelaster.txt.gz er en rigtig liste "Bars, End forces" fra FEM-Design (standardtaget, 8 STR-kombinationer),
// gemt som tekstfil uden overskrift. Facit for de dimensionerende tilfælde opdateres med `npm run test:update`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./load');

const { TR, TC } = load();
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const FIXTURE = path.join(__dirname, 'fixtures', 'endelaster.txt.gz');
const SNAP = path.join(__dirname, 'snapshots', 'samlinger-endelaster.csv');

function geometry() {
  const params = Object.assign({}, TR.DEFAULTS);
  params.combos = TR.normCombos(params.combos);
  return TR.computeGeometry(params);
}
// -0 og 0 er det samme her
function z(a) { return a.map((v) => v + 0); }
function fixtureText() { return zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8'); }
function memberLength(m) { return Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]); }
function allGoverning(F, g) {
  const N = TC.buildNodes(g), M = TC.matchBars(F, g);
  return { N, M, G: TC.governing(N, N.nodes.map((nd) => nd.id), M, F.combos) };
}
// samme kræfter som listen "Bars, Internal forces" med x = 0 og x = L, i det format, opbygningen angiver
function asInternalForces(F, g, o) {
  const lengths = {};
  g.members.forEach((m) => { lengths[m.name] = memberLength(m); });
  const fmt = o.fmt || ((v) => v.toFixed(3));
  const lines = [];
  F.combos.forEach((cn, c) => {
    lines.push('Bars, Internal forces, Load comb.: ' + cn);
    lines.push(['ID', 'x', 'N', "Ty'", "Tz'", 'Mt,SV', "My'", "Mz'", 'B', 'Mt,w', 'Mt,tot'].join(o.sep));
    lines.push(['[-]', '[m]', '[kN]', '[kN]', '[kN]', '[kNm]', '[kNm]', '[kNm]', '[kNm²]', '[kNm]', '[kNm]'].join(o.sep));
    F.ids.forEach((id) => {
      const L = lengths[id.replace(/\.\d+$/, '')];
      const b = F.bars[id];
      [[0, b.s[c]], [L, b.e[c]]].forEach(([x, f]) => {
        lines.push([id, fmt(x)].concat(f.map(fmt), ['-', '-', '-']).join(o.sep));
      });
    });
    lines.push('');
  });
  return lines.join('\r\n');
}

test('endelaster uden overskrift læses og kobles til alle stænger', () => {
  const g = geometry();
  const F = TC.parseForces(TC.textRows(fixtureText()));
  assert.deepEqual(F.warnings, []);
  assert.equal(F.ends, true);
  assert.equal(F.thousands, false);
  assert.deepEqual(F.combos, ['1 STR 6.10a', '2 STR Nyttelast, punkt', '3 STR Gangbro, nyttelast', '4 STR Sne, jævn',
    '5 STR Sne, ensidig', '6 STR Vind 0°', '7 STR Overtryk', '8 STR Undertryk']);
  assert.equal(F.ids.length, g.members.length);
  // første række i filen: KANT1.1.1 Start 275.098 -17.138 1.021 -0.000 0.000 -19.103, og End med Mz = 19.163
  assert.deepEqual(z(F.bars['KANT1.1.1'].s[0]), [275.098, -17.138, 1.021, 0, 0, -19.103]);
  assert.deepEqual(z(F.bars['KANT1.1.1'].e[0]), [275.098, -17.138, -1.021, 0, 0, 19.163]);
  const { M } = allGoverning(F, g);
  assert.equal(Object.keys(M.bars).length, g.members.length);
  assert.deepEqual([M.unknown, M.missing, M.mismatch], [[], [], []]);
});

test('endelaster med overskrift giver det samme som uden', () => {
  const text = fixtureText();
  const head = ['ID', 'Pos.', 'N', "Ty'", "Tz'", 'Mt,SV', "My'", "Mz'", 'B', 'Mt,w', 'Mt,tot', 'Comb.'].join('\t');
  const F0 = TC.parseForces(TC.textRows(text));
  const F1 = TC.parseForces(TC.textRows(head + '\r\n' + text));
  assert.deepEqual(F1, F0);
});

test('samme kræfter som Internal forces giver samme dimensionerende tilfælde', () => {
  const g = geometry();
  const F = TC.parseForces(TC.textRows(fixtureText()));
  const ref = TC.governingCsv(allGoverning(F, g).G);
  // FEM-Designs tekstfil med tabulator og punktum
  const Ftab = TC.parseForces(TC.textRows(asInternalForces(F, g, { sep: '\t' })));
  assert.deepEqual(Ftab.warnings, []);
  assert.equal(TC.governingCsv(allGoverning(Ftab, g).G), ref);
  // gemt fra dansk Excel som CSV: semikolon, decimalkomma og punktum som tusindtalsskilletegn
  const dk = (v) => v.toFixed(3).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.');
  assert.equal(dk(-1234.5), '-1.234,500');
  const Fdk = TC.parseForces(TC.textRows(asInternalForces(F, g, { sep: ';', fmt: dk })));
  assert.deepEqual(Fdk.warnings, []);
  assert.equal(TC.governingCsv(allGoverning(Fdk, g).G), ref);
});

test('Excel med dansk talformat: punktum læst som tusindtalsskilletegn rettes', () => {
  // tal ≥ 1 bliver hele tal ×1000, tal under 1 bliver stående som tekst
  const rows = [
    ['Bars, Internal forces, Load comb.: STR 6.10a'],
    ['ID', 'x', 'N', "Ty'", "Tz'", 'Mt', "My'", "Mz'"],
    ['RB.1', 0, 275098, '0.512', -17138, '-0.000', 1021, 19103],
    ['RB.1', 4500, 275098, '0.512', -17138, '-0.000', 1021, -19163]
  ];
  const F = TC.parseForces(rows);
  assert.equal(F.thousands, true);
  assert.deepEqual(z(F.bars['RB.1'].s[0]), [275.098, 0.512, -17.138, 0, 1.021, 19.103]);
  assert.equal(F.bars['RB.1'].xe[0], 4.5);
});

test('dimensionerende tilfælde i alle knuder fra endelasterne', () => {
  const g = geometry();
  const F = TC.parseForces(TC.textRows(fixtureText()));
  const csv = TC.governingCsv(allGoverning(F, g).G);
  if (UPDATE) { fs.writeFileSync(SNAP, csv); return; }
  assert.ok(fs.existsSync(SNAP), 'Facit mangler. Kør `npm run test:update`.');
  const exp = fs.readFileSync(SNAP, 'utf8').split('\r\n'), got = csv.split('\r\n');
  const i = got.findIndex((l, k) => l !== exp[k]);
  if (i >= 0) assert.fail('Linje ' + (i + 1) + ' afviger fra facit:\n  facit: ' + exp[i] + '\n  nu:    ' + got[i]);
  assert.equal(got.length, exp.length);
});

test('rapporten over samlingerne indeholder grundlaget og alle knudetyper', () => {
  const g = geometry();
  const F = TC.parseForces(TC.textRows(fixtureText()));
  const { N, G } = allGoverning(F, g);
  const html = TC.report(G, { title: 'Snitkræfter i samlingerne', subtitle: 'test', file: 'Endelaster.txt', ends: F.ends, combos: F.combos, nodes: N.nodes.map((nd) => nd.id) });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Endelaster\.txt \(Bars, End forces\)/);
  assert.match(html, /8: 1 STR 6\.10a; 2 STR Nyttelast, punkt;/);
  G.forEach((t) => assert.ok(html.includes('<h3>' + t.type.replace(/&/g, '&amp;') + '</h3>'), t.type));
  // alle knuder står i rapporten, også når der er mange af samme type
  assert.ok(!html.includes(' …</p>'));
});

test('samlinger: knuder og stænger valgt til hver samling, hentet som Excel-ark', async () => {
  const g = geometry();
  const F = TC.parseForces(TC.textRows(fixtureText()));
  const N = TC.buildNodes(g), M = TC.matchBars(F, g);
  const asg = TC.seedAssign(TC.newAssign(), N);
  // udgangspunkt: samling 1 er RB mod centrum i alle 24 KS-knuder
  const ks = N.nodes.filter((nd) => /^KS\.\d+$/.test(nd.name));
  assert.equal(ks.length, 24);
  assert.deepEqual(asg.sel[0].slice().sort(), ks.map((nd) => nd.id).sort());
  assert.deepEqual(asg.roles[0], ['RB mod centrum']);
  // samling 2 er RB mod svøbet i de 24 KR-knuder, samling 3 SEK mod centrum i de 24 sektionsspær ved svøbet
  assert.deepEqual(asg.sel[1].map((id) => N.nodes.find((nd) => nd.id === id).name).sort(), N.nodes.filter((nd) => /^KR\.\d+$/.test(nd.name)).map((nd) => nd.name).sort());
  assert.equal(asg.sel[1].length, 24);
  assert.deepEqual(asg.roles[1], ['RB mod svøbet']);
  assert.equal(asg.sel[2].length, 24);
  assert.ok(asg.sel[2].every((id) => N.nodes.find((nd) => nd.id === id).type === 'SEK ved svøbet'));
  assert.deepEqual(asg.roles[2], ['SEK mod centrum']);
  assert.deepEqual(asg.names.slice(0, 3), ['IPE 330 til tagkant', 'IPE 330 til ringbjælke', 'IPE 180 til tagkant']);
  // KS.3 fravalgt; samling 2 er alle stænger i KS.1
  const ks3 = ks.find((nd) => nd.name === 'KS.3'), ks1 = ks.find((nd) => nd.name === 'KS.1');
  asg.sel[0] = asg.sel[0].filter((id) => id !== ks3.id);
  asg.sel[1] = [ks1.id]; asg.roles[1] = null;
  assert.deepEqual(TC.nodeRoles(N, asg.sel[1]), ks1.ends.map((e) => e.role));
  const se = TC.samlingEnds(N, M, F.combos, asg);
  assert.equal(se.ends[1].length, 23 * F.combos.length);
  assert.ok(se.ends[1].every((r) => r[2] === 'RB mod centrum' && r[0] !== 'KS.3'));
  assert.equal(se.ends[2].length, ks1.ends.length * F.combos.length);
  assert.equal(se.ends[3].length, 24 * F.combos.length);
  assert.deepEqual(se.ends.slice(4).map((e) => e.length), [0, 0, 0, 0]);

  const buf = await TC.samlingerXlsx(N, M, F.combos, asg);
  const rows = await TC.readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.ok(rows.some((r) => r[0] === 'N_Rd'), 'fanen Samling 1 har eftervisningen');
  assert.ok(rows.some((r) => r[0] === 'Samling 2: IPE 330 til ringbjælke'), 'fanen Samling 2');
  assert.ok(rows.some((r) => r[0] === 'u(V_y,Rd, V_y,Ed)'), 'samling 2 eftervises for V_y,Ed');
  assert.ok(rows.some((r) => r[0] === 'Samling 3: IPE 180 til tagkant'), 'fanen Samling 3');
  assert.ok(rows.some((r) => r[0] === 'u(V_z,Rd, V_z,Ed)'), 'samling 3 eftervises for V_z,Ed');
  const head = rows.find((r) => r[0] === 'Knude' && r[1] === 'Knudetype' && r[5] === 'Kombination');
  assert.deepEqual(head.slice(12), ['Første', 'N_d [kN]', 'V_d [kN]', 'UR_N', 'UR_V', 'UR']);
  const data = rows.slice(rows.indexOf(head) + 1, rows.indexOf(head) + 1 + se.ends[1].length);
  assert.ok(data.every((r) => r[2] === 'RB mod centrum'));
  const ks7 = data.find((r) => r[0] === 'KS.7' && r[5] === '5 STR Sne, ensidig');
  assert.equal(ks7[6], se.ends[1].find((e) => e[0] === 'KS.7' && e[5] === '5 STR Sne, ensidig')[6]);
});

test('samlinger: gemt tildeling fra før samling 2 og 3 får deres udgangspunkt uden at røre samling 1', () => {
  const N = TC.buildNodes(geometry());
  const asg = TC.newAssign();
  const kr1 = N.nodes.find((nd) => nd.name === 'KR.1');
  asg.names[0] = 'Min samling'; asg.sel[0] = [kr1.id]; asg.roles[0] = null; asg.seeded = true;
  TC.seedAssign(asg, N);
  assert.deepEqual(asg.seeded, [1, 2, 3]);
  assert.deepEqual([asg.names[0], asg.sel[0], asg.roles[0]], ['Min samling', [kr1.id], null]);
  assert.equal(asg.sel[1].length, 24);
  assert.equal(asg.sel[2].length, 24);
  // allerede valgte knuder overskrives ikke, og udgangspunktet sættes kun én gang
  const b = TC.newAssign();
  b.sel[1] = [kr1.id]; b.roles[1] = ['RING mod uret'];
  TC.seedAssign(b, N);
  assert.deepEqual([b.sel[1], b.roles[1]], [[kr1.id], ['RING mod uret']]);
  b.sel[2] = [];
  TC.seedAssign(b, N);
  assert.deepEqual(b.sel[2], []);
});
