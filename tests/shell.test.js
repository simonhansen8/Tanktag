'use strict';
// Skalmodellen af én radialbjælke (TankShell): skallerne hænger sammen, lasterne er enhedslaster i ligevægt,
// og understøtningerne sidder i enderne og i topflangen ved udvekslingsringene.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./load');

const { TR, TS, LIB } = load();
const CASES_DIR = path.join(__dirname, 'cases');
const TOL = 1e-6;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.hypot(...a); }
function same(a, b) { return len(sub(a, b)) < TOL; }
function sameEdge(e, f) { return (same(e[0], f[0]) && same(e[1], f[1])) || (same(e[0], f[1]) && same(e[1], f[0])); }

// punktet q ligger i den plane firkant P (indenfor eller på kanten)
function onQuad(q, P) {
  const n = cross(sub(P[1], P[0]), sub(P[3], P[0])), ln = len(n);
  if (Math.abs(dot(sub(q, P[0]), n)) / ln > TOL) return false;
  for (let k = 0; k < 4; k++) {
    const a = P[k], b = P[(k + 1) % 4];
    if (dot(cross(sub(b, a), sub(q, a)), n) / ln < -TOL) return false;
  }
  return true;
}

function wellFormed(xml) {
  const stack = [], re = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g;
  const body = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
  let m;
  while ((m = re.exec(body))) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else assert.equal(stack.pop(), m[2], 'forkert indlejring ved </' + m[2] + '>');
  }
  assert.deepEqual(stack, []);
}

fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort().forEach((file) => {
  const spec = JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8'));
  const params = Object.assign({}, TR.DEFAULTS, spec.params);
  params.combos = TR.normCombos(params.combos);

  test('skalmodel af RB.1: ' + file, () => {
    const geom = TR.computeGeometry(params);
    let guid = 0;
    const res = TS.buildRafterStruxml(TR, geom, LIB, {
      timestamp: '2000-01-01T00:00:00.000', guid: () => '00000000-0000-4000-8000-' + String(++guid).padStart(12, '0')
    });
    const { xml, rafter: R, cases, supports } = res;
    const radial = geom.members.filter((m) => m.group === 'radial' && m.index === 0);
    wellFormed(xml);

    // tre skaller pr. stykke af RB.1, og bjælkemodellen ved siden af med én stang pr. stykke; ingen dæk
    assert.equal(R.pieces.length, radial.length);
    assert.equal((xml.match(/<slab /g) || []).length, 3 * radial.length);
    assert.equal((xml.match(/<bar /g) || []).length, radial.length);
    assert.ok(!xml.includes('<cover '));
    assert.equal((xml.match(/<load_case type=/g) || []).length, 6);
    assert.equal((xml.match(/<load_combination /g) || []).length, 6);
    assert.ok(xml.indexOf('<bar ') < xml.indexOf('<slab '), 'stængerne skal stå før skallerne');
    assert.ok(xml.includes('<sections>') && xml.indexOf('</entities>') < xml.indexOf('<sections>'));

    const allPlates = [];
    R.pieces.forEach((pc) => {
      const [web, top, bot] = pc.plates;
      allPlates.push(web.pts, top.pts, bot.pts);
      assert.equal(web.t, R.dims.tw);
      assert.equal(top.t, R.dims.tf);
      const n = cross(sub(web.pts[1], web.pts[0]), sub(web.pts[3], web.pts[0]));
      assert.ok(Math.abs(n[2]) / len(n) < 1e-9, 'kroppen er ikke lodret');
      pc.plates.forEach((pl) => {
        const nn = cross(sub(pl.pts[1], pl.pts[0]), sub(pl.pts[3], pl.pts[0]));
        assert.ok(Math.abs(dot(sub(pl.pts[2], pl.pts[0]), nn)) / len(nn) < 1e-9, 'skallen er ikke plan');
      });
      assert.ok(onQuad(web.pts[2], top.pts) && onQuad(web.pts[3], top.pts));
      assert.ok(onQuad(web.pts[0], bot.pts) && onQuad(web.pts[1], bot.pts));
    });
    // nabostykkerne deler endekanterne
    for (let j = 0; j < R.pieces.length - 1; j++) {
      for (let k = 0; k < 3; k++) {
        const P = R.pieces[j].plates[k].pts, Q = R.pieces[j + 1].plates[k].pts;
        assert.ok(sameEdge([P[1], P[2]], [Q[0], Q[3]]), 'stykke ' + (j + 1) + '/' + (j + 2) + ' skal ' + k + ' hænger ikke sammen');
      }
    }
    const onPlate = (q) => allPlates.some((P) => onQuad(q, P));

    // trykket: i ligevægt, N = 1 kN ind i hver ende, og hvert stykke får rent normalkraft
    let F = [0, 0, 0];
    cases[0].lines.forEach((l) => { F = add(F, scale(l.dir, l.val * len(sub(l.b, l.a)))); });
    cases[0].points.forEach((q) => { F = add(F, scale(q.dir, q.val)); });
    assert.ok(len(F) < 1e-9, 'trykket er ikke i ligevægt: ' + F);
    const first = R.pieces[0];
    let Nin = 0;
    cases[0].lines.slice(0, 3).forEach((l) => { Nin += dot(l.dir, first.x) * l.val * len(sub(l.b, l.a)); });
    assert.ok(Math.abs(Nin - TS.UNIT_N) < 1e-9, 'trykket ved ringbjælken er ' + Nin);
    assert.equal(cases[0].points.length, R.pieces.length - 1 - R.pieces.filter((pc, j) => j < R.pieces.length - 1 && same(pc.x, R.pieces[j + 1].x)).length);
    // linjelasterne: samlet q·L lodret, nedad og opad, langs overflangens midte
    const total = R.pieces.reduce((a, pc) => a + pc.length, 0);
    [[1, -1], [2, 1]].forEach(([ci, sgn]) => {
      let Fz = 0;
      cases[ci].lines.forEach((l) => {
        Fz += l.dir[2] * l.val * len(sub(l.b, l.a));
        assert.ok(R.pieces.some((pc) => onQuad(l.a, pc.plates[1].pts) && onQuad(l.b, pc.plates[1].pts)), 'lasten ligger ikke i overflangen');
      });
      assert.ok(Math.abs(Fz - sgn * TS.UNIT_Q * total) < 1e-9);
    });
    cases.forEach((c) => c.lines.forEach((l) => assert.ok(onPlate(l.a) && onPlate(l.b), 'en linjelast ligger ikke på en skal')));
    cases[0].points.forEach((q) => assert.ok(onPlate(q.pos)));

    // understøtningerne: gaffellejer i begge ender og én sidefastholdelse i topflangen pr. udvekslingsring
    supports.filter((s) => !/^B\./.test(s.name)).forEach((s) => assert.ok(onPlate(s.pos), s.name + ' sidder ikke på en skal'));

    // bjælkemodellen: 3 m vandret på tværs, samme laster i egne tilfælde, lejer i knuderne
    const ov = scale(R.pieces[0].y, 3);
    assert.ok(Math.abs(R.pieces[0].y[2]) < 1e-12);
    const bars = [...xml.matchAll(/<bar name="(RBB[^"]+)"[\s\S]*?<curve type="line">\s*<point x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>\s*<point x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)];
    assert.equal(bars.length, R.pieces.length);
    bars.forEach((b, j) => {
      assert.ok(same([+b[2], +b[3], +b[4]], add(R.pieces[j].member.start, ov)) && same([+b[5], +b[6], +b[7]], add(R.pieces[j].member.end, ov)));
    });
    const bc = res.beamCases;
    assert.deepEqual(bc.map((c) => c.name), ['Tryk N – bjælkemodel', 'Last ned – bjælkemodel', 'Last op – bjælkemodel']);
    let FB = [0, 0, 0];
    bc[0].points.forEach((q) => { FB = add(FB, scale(q.dir, q.val)); });
    assert.ok(len(FB) < 1e-9);
    let FzB = 0;
    bc[1].lines.forEach((l) => { FzB += l.dir[2] * l.val * len(sub(l.b, l.a)); });
    assert.ok(Math.abs(FzB + TS.UNIT_Q * total) < 1e-9);
    const bs = supports.filter((s) => /^B\./.test(s.name));
    assert.equal(bs.length, 2 + R.holds.length);
    assert.deepEqual(bs.find((s) => s.name === 'B.GL.R').m, [true, true, true]);
    assert.deepEqual(bs.find((s) => s.name === 'B.GL.R').r, [true, false, false]);
    R.holds.forEach((h) => assert.ok(bs.some((s) => s.name === 'B.SF.' + h.ring && same(s.pos, add(h.node, ov)))));
    // trykket i bjælkemodellen: ingen punktlast står på en understøtning (FEM-Design fører den direkte ned i den),
    // men 1 mm inde på en af stængerne, og trykket i enderne går langs stængernes akse
    bc[0].points.forEach((q) => {
      bs.forEach((s) => assert.ok(len(sub(q.pos, s.pos)) > 0.0005, 'punktlast på ' + s.name));
      const onBar = R.pieces.some((pc) => {
        const a = add(pc.member.start, ov), b = add(pc.member.end, ov), t = dot(sub(q.pos, a), pc.x);
        return t > 0 && t < pc.length && len(sub(q.pos, add(a, scale(pc.x, t)))) < 1e-9;
      });
      assert.ok(onBar, 'punktlasten ligger ikke på en stang');
    });
    assert.ok(same(bc[0].points[0].pos, add(add(R.pieces[0].member.start, ov), scale(R.pieces[0].x, 0.001))));
    assert.ok(same(bc[0].points[1].pos, add(add(R.pieces[R.pieces.length - 1].member.end, ov), scale(R.pieces[R.pieces.length - 1].x, -0.001))));
    assert.equal(R.holds.length, geom.info.radii.length);
    R.holds.forEach((h) => {
      const top = h.piece.plates[1].pts;
      assert.ok(onQuad(h.pos, top), 'SF.' + h.ring + ' sidder ikke i topflangen');
      assert.ok(Math.abs(Math.hypot(h.node[0], h.node[1]) - geom.info.radii[h.ring - 1]) < TOL);
    });
    const sf = supports.filter((s) => /^SF\./.test(s.name));
    assert.equal(sf.length, geom.info.radii.length);
    sf.forEach((s) => assert.deepEqual(s.m, [false, true, false]));
    assert.equal(supports.filter((s) => s.m[0] && !/^B\./.test(s.name)).length, 1, 'aksialt fastholdt ét sted');
  });
});

test('skalmodel: tykkelser af IPE 330 og HE 300 B', () => {
  const near = (d, e) => Object.keys(e).forEach((k) => assert.ok(Math.abs(d[k] - e[k]) < 1e-9, k + ': ' + JSON.stringify(d)));
  near(TS.plateDims(TR, LIB, 'IPE|330'), { h: 0.33, b: 0.16, tf: 0.0115, tw: 0.0075 });
  near(TS.plateDims(TR, LIB, 'HE-B|300'), { h: 0.3, b: 0.3, tf: 0.019, tw: 0.011 });
});

test('skalmodel: andre profiler end I og H afvises', () => {
  assert.throws(() => TS.plateDims(TR, LIB, 'UPE|300'), /kun lave radialbjælker af/);
});

test('skalmodel: indstillingerne fra fanen Skalmodel', () => {
  const params = Object.assign({}, TR.DEFAULTS);
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  const op = TS.options({ beam: '3', meshSize: '50', endPlate: '10', axialAt: 'shell', holdPos: 'centre', holdRings: '1; 3',
    holdStiff: '500', caseUp: false, N: '2', q: '2,5', qPos: 'bottom' }, geom);
  assert.deepEqual(op.errors, []);
  assert.equal(op.o.index, 2);
  const { xml, rafter: R, cases, supports } = TS.buildRafterStruxml(TR, geom, LIB, op.o);
  wellFormed(xml);
  // RB.3, fem stykker med krop og flanger plus to endeplader
  assert.ok(R.pieces.every((pc) => pc.member.index === 2));
  assert.equal((xml.match(/<slab /g) || []).length, 3 * R.pieces.length + 2);
  assert.equal((xml.match(/val="0.01"/g) || []).length, 2);
  assert.ok(/mesh_size="0.05"/.test(xml));
  R.endPlates.forEach((pl) => assert.ok(supports.filter((s) => /^GL\./.test(s.name)).some((s) => onQuad(s.pos, pl.pts))));
  // aksialt ved svøbet, sidefastholdelse som fjeder i systemlinjen ved ring 1 og 3
  assert.deepEqual(supports.filter((s) => s.m[0] === true).map((s) => s.name), ['GL.S', 'B.GL.S']);
  assert.deepEqual(R.holds.map((h) => h.ring), [1, 3]);
  R.holds.forEach((h) => assert.ok(same(h.pos, h.node)));
  supports.filter((s) => /^SF\./.test(s.name)).forEach((s) => assert.deepEqual(s.m, [false, 500, false]));
  assert.ok(xml.includes('y_neg="500" y_pos="500"'));
  // to lasttilfælde, N = 2 kN og q = 2,5 kN/m langs underflangen
  assert.deepEqual(cases.map((c) => c.name), ['Tryk N', 'Last ned på underflange']);
  let Nin = 0;
  cases[0].lines.slice(0, 3).forEach((l) => { Nin += dot(l.dir, R.pieces[0].x) * l.val * len(sub(l.b, l.a)); });
  assert.ok(Math.abs(Nin - 2) < 1e-9);
  const total = R.pieces.reduce((a, pc) => a + pc.length, 0);
  let Fz = 0;
  cases[1].lines.forEach((l) => {
    Fz += l.dir[2] * l.val * len(sub(l.b, l.a));
    assert.ok(R.pieces.some((pc) => onQuad(l.a, pc.plates[2].pts) && onQuad(l.b, pc.plates[2].pts)), 'lasten ligger ikke i underflangen');
  });
  assert.ok(Math.abs(Fz + 2.5 * total) < 1e-9);
  assert.equal((xml.match(/<load_combination /g) || []).length, 4);

  // ingen sidefastholdelse og ingen bjælkemodel
  const none = TS.buildRafterStruxml(TR, geom, LIB, TS.options({ holdPos: 'none', beamOffset: '0' }, geom).o);
  assert.equal(none.rafter.holds.length, 0);
  assert.ok(!none.xml.includes('name="SF.') && !none.xml.includes('<bar ') && !none.xml.includes('<sections>'));
  assert.equal(none.beamCases.length, 0);

  // fejl i indstillingerne
  const bad = TS.options({ beam: 99, meshSize: -1, holdRings: '7', holdStiff: '-2', caseN: false, caseDown: false, caseUp: false, beamOffset: '-1' }, geom);
  assert.equal(bad.errors.length, 6, bad.errors.join(' | '));
});

// regnearket til kalibrering af kipnings-β: skabelonen udfyldes for den valgte radialbjælke
test('skalmodel: regnearket til kalibrering af kipnings-β udfyldes', async () => {
  const { BETA_XLSX, TC } = load();
  const params = Object.assign({}, TR.DEFAULTS, { bkRadialTop: 0.8, bkRadialBottom: 1.2 });
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  const ab = BETA_XLSX.buffer.slice(BETA_XLSX.byteOffset, BETA_XLSX.byteOffset + BETA_XLSX.length);
  const parts = TC.unzip(ab), files = {}, dec = new TextDecoder();
  for (const k of Object.keys(parts)) files[k] = dec.decode(await TC.inflate(parts[k]));
  const op = TS.options({ beam: 2 }, geom);
  const res = TS.betaWorkbook(TR, geom, LIB, op.o, files);
  const R = TS.rafter(TR, geom, LIB, op.o);
  const cell = (xml, ref) => { const m = new RegExp('<c r="' + ref + '"[^>]*?(?:/>|>([\\s\\S]*?)</c>)').exec(xml); assert.ok(m, ref); return m[1] || ''; };
  const num = (xml, ref) => Number(/<v>([^<]*)<\/v>/.exec(cell(xml, ref))[1]);
  const txt = (xml, ref) => (/<t[^>]*>([^<]*)<\/t>/.exec(cell(xml, ref)) || [])[1];
  const K = res.files['xl/worksheets/sheet2.xml'], S = res.files['xl/worksheets/sheet3.xml'], L = res.files['xl/worksheets/sheet4.xml'];
  wellFormed(K); wellFormed(S); wellFormed(L);
  // antal sektioner, længder og styrende sektion (midt på spæret)
  assert.equal(num(K, 'C5'), R.pieces.length);
  assert.equal(res.sections, R.pieces.length);
  const lens = R.pieces.map((pc) => pc.length), tot = lens.reduce((a, l) => a + l, 0);
  assert.ok(Math.abs(num(K, 'C6') - tot) < 1e-3);
  assert.equal(txt(K, 'C7'), 'Nej');
  lens.forEach((l, j) => assert.ok(Math.abs(num(S, 'C' + (11 + j)) - l) < 1e-3));
  assert.equal(cell(S, 'C' + (11 + lens.length)), '');
  let x = 0, gov = 0;
  while (x + lens[gov] < tot / 2) x += lens[gov++];
  assert.equal(num(K, 'C14'), gov + 1);
  assert.equal(num(K, 'C42'), gov + 1);
  // start-β fra modellens kipnings-β, og α_cr og M_Ed,max står tomme til brugeren
  assert.equal(num(K, 'C16'), 0.8);
  assert.equal(num(K, 'C44'), 1.2);
  ['C11', 'C12', 'C39', 'C40', 'F19', 'F21', 'D20', 'F47', 'F50'].forEach((r) => assert.equal(cell(K, r), '', r));
  assert.match(txt(K, 'E5'), /^RB\.2, IPE 330: \d+ sektioner/);
  assert.match(txt(K, 'E11'), /Last ned på overflange/);
  // formlerne og formaterne er urørte
  assert.match(K, /<c r="C13" s="\d+"[^>]*><f>IF\(OR\(C11="",C12=""\),"",C11\*C12\)<\/f>/);
  assert.match(K, /<c r="C16" s="17"><v>0.8<\/v><\/c>/);
  // lastformerne: eksemplerne er væk, de to lasttilfælde står klar
  assert.equal(txt(L, 'C6'), 'Last ned på overflange');
  assert.equal(txt(L, 'D7'), 'Bund');
  ['E6', 'F6', 'H6', 'I6', 'E7'].forEach((r) => assert.equal(cell(L, r), '', r));
  assert.ok(cell(L, 'G6').includes('<f'));
  assert.match(res.files['xl/workbook.xml'], /<calcPr[^>]*fullCalcOnLoad="1"\/>/);
  // skabelonens gemte resultater og beregningskæde er fjernet
  assert.ok(!/<\/f><v>/.test(K) && !/<\/f><v>/.test(S) && !/<\/f><v>/.test(L));
  assert.ok(!res.files['xl/calcChain.xml'] && !res.files['[Content_Types].xml'].includes('calcChain') && !res.files['xl/_rels/workbook.xml.rels'].includes('calcChain'));
  // kan pakkes som zip igen
  const z = await TC.zip(res.files);
  const back = TC.unzip(z.buffer);
  assert.deepEqual(Object.keys(back).sort(), Object.keys(files).filter((k) => k !== 'xl/calcChain.xml').sort());
});

test('skalmodel: lejerne vælges for hver ende og gælder også bjælkemodellen', () => {
  const params = Object.assign({}, TR.DEFAULTS);
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  const op = TS.options({ supRing: 'lateral', supShell: 'fork', rotRing: 'fixed', rotShell: 'free' }, geom);
  assert.deepEqual(op.errors, []);
  assert.equal(TS.supportText(op.o), 'ved ringbjælken sidefastholdt med fri vridning, indspændt om den stærke akse og ved svøbet gaffelleje');
  assert.equal(TS.supportText(TS.options({}, geom).o), 'gaffellejer i begge ender');
  const { xml, supports } = TS.buildRafterStruxml(TR, geom, LIB, op.o);
  wellFormed(xml);
  const by = (n) => supports.find((s) => s.name === n);
  // ringbjælken: midten på tværs (fri vridning), over- og underkanten aksialt (indspændt)
  assert.deepEqual(by('GL.R').m, [true, true, true]);
  assert.deepEqual(by('GL.RO').m, [true, false, true]);
  assert.deepEqual(by('GL.RU').m, [true, false, true]);
  // svøbet: gaffelleje som standard
  assert.deepEqual(by('GL.S').m, [false, false, true]);
  assert.deepEqual(by('GL.SO').m, [false, true, true]);
  assert.deepEqual(by('B.GL.R').m, [true, true, true]);
  assert.deepEqual(by('B.GL.R').r, [false, true, false]);
  assert.deepEqual(by('B.GL.S').m, [false, true, true]);
  assert.deepEqual(by('B.GL.S').r, [true, false, false]);
  // fri på tværs ved svøbet: ingen fastholdelse på tværs og ingen vridning
  const o2 = TS.options({ supShell: 'free' }, geom).o, s2 = TS.buildRafterStruxml(TR, geom, LIB, o2).supports;
  ['GL.S', 'GL.SO', 'GL.SU', 'B.GL.S'].forEach((n) => assert.equal(s2.find((s) => s.name === n).m[1], false, n));
  assert.deepEqual(s2.find((s) => s.name === 'B.GL.S').r, [false, false, false]);
  // ustabile valg afvises
  assert.match(TS.options({ supRing: 'free', supShell: 'free', holdPos: 'none' }, geom).errors.join(' '), /på tværs et sted/);
  assert.match(TS.options({ supRing: 'lateral', supShell: 'lateral', holdPos: 'centre' }, geom).errors.join(' '), /mod vridning/);
  assert.deepEqual(TS.options({ supRing: 'lateral', supShell: 'lateral', holdPos: 'top' }, geom).errors, []);
  assert.match(TS.options({ supRing: 'x' }, geom).errors.join(' '), /Ukendt leje/);
});

test('skalmodel: fastholdelserne som linjeunderstøtninger', () => {
  const params = Object.assign({}, TR.DEFAULTS);
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  const op = TS.options({ supType: 'line', supShell: 'lateral', rotShell: 'fixed', holdStiff: '300' }, geom);
  assert.deepEqual(op.errors, []);
  assert.match(TS.supportText(op.o), /linjeunderstøtninger/);
  const { xml, rafter: R, supports, lineSupports: ls } = TS.buildRafterStruxml(TR, geom, LIB, op.o);
  wellFormed(xml);
  const first = R.pieces[0], last = R.pieces[R.pieces.length - 1], by = (n) => ls.find((s) => s.name === n);
  // endekanterne: én linje fra under- til overkant af kroppen, lokal x langs linjen, lokal y på tværs
  const gr = by('GL.R'), gs = by('GL.S');
  assert.ok(same(gr.a, add(first.member.start, scale(first.mS, -R.d))) && same(gr.b, add(first.member.start, scale(first.mS, R.d))));
  assert.ok(same(gs.a, add(last.member.end, scale(last.mE, -R.d))) && same(gs.b, add(last.member.end, scale(last.mE, R.d))));
  [gr, gs].forEach((s) => { assert.ok(Math.abs(dot(s.x, s.y)) < 1e-9); assert.ok(same(s.y, first.y)); });
  // ringbjælken: gaffelleje og aksialt (punkt i midten); svøbet: kun sidefastholdt (punkt) og indspændt (linjen aksialt)
  assert.deepEqual(gr.m, [true, true, false]);
  assert.deepEqual(gs.m, [true, false, true]);
  assert.deepEqual(supports.find((s) => s.name === 'GL.R').m, [true, false, false]);
  assert.deepEqual(supports.find((s) => s.name === 'GL.S').m, [false, true, false]);
  assert.equal(supports.filter((s) => /^GL\.[RS][OU]$/.test(s.name)).length, 0);
  // sidefastholdelserne ved udvekslingerne er altid punkter i topflangen, med stivheden uændret
  assert.equal(ls.filter((s) => /^SF\./.test(s.name)).length, 0);
  const sf = supports.filter((s) => /^SF\./.test(s.name));
  assert.equal(sf.length, R.holds.length);
  sf.forEach((s, k) => { assert.ok(same(s.pos, R.holds[k].pos)); assert.deepEqual(s.m, [false, 300, false]); });
  assert.equal((xml.match(/<line_support /g) || []).length, 2);
  assert.ok(xml.includes('moving_local="false"'));
  assert.ok(xml.includes('x_neg="10000000" x_pos="10000000"'));
  // bjælkemodellen har stadig punkter
  assert.ok(supports.some((s) => s.name === 'B.GL.R') && supports.some((s) => s.name === 'B.GL.S'));
});

test('skalmodel: fuldt vridningsfastholdt leje – hele endetværsnittet på tværs', () => {
  const params = Object.assign({}, TR.DEFAULTS);
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  const op = TS.options({ supRing: 'full', supShell: 'full', rotShell: 'fixed', holdPos: 'none' }, geom);
  assert.deepEqual(op.errors, []);
  assert.match(TS.supportText(op.o), /^ved ringbjælken fuldt vridningsfastholdt og ved svøbet fuldt vridningsfastholdt, indspændt/);
  const { xml, rafter: R, supports } = TS.buildRafterStruxml(TR, geom, LIB, op.o);
  wellFormed(xml);
  const first = R.pieces[0], by = (n) => supports.find((s) => s.name === n);
  // ringbjælken: kroppen i midten, over- og underkant og alle fire flangespidser fastholdt på tværs
  ['GL.R', 'GL.RO', 'GL.RU', 'GL.RO1', 'GL.RO2', 'GL.RU1', 'GL.RU2'].forEach((n) => assert.equal(by(n).m[1], true, n));
  const tips = ['GL.RO1', 'GL.RO2', 'GL.RU1', 'GL.RU2'].map((n) => by(n).pos);
  tips.forEach((q) => assert.ok(first.plates.slice(1).some((pl) => pl.pts.some((c) => same(c, q))), 'flangespids'));
  // svøbet indspændt: også flangespidserne aksialt
  ['GL.SO', 'GL.SU', 'GL.SO1', 'GL.SO2', 'GL.SU1', 'GL.SU2'].forEach((n) => assert.equal(by(n).m[0], true, n));
  assert.equal(by('GL.RO1').m[0], false);
  assert.deepEqual(by('B.GL.R').r, [true, false, false]);
  // som linjer: kroppens endekant og begge flanger i hele bredden
  const ls = TS.buildRafterStruxml(TR, geom, LIB, TS.options({ supType: 'line', supRing: 'full' }, geom).o).lineSupports;
  const fo = ls.find((s) => s.name === 'GL.RO'), fu = ls.find((s) => s.name === 'GL.RU');
  [fo, fu].forEach((s) => { assert.ok(Math.abs(len(sub(s.b, s.a)) - R.dims.b) < 1e-9); assert.deepEqual(s.m, [true, false, false]); });
  assert.ok(onQuad(fo.a, first.plates[1].pts) && onQuad(fo.b, first.plates[1].pts));
  assert.ok(onQuad(fu.a, first.plates[2].pts) && onQuad(fu.b, first.plates[2].pts));
  assert.deepEqual(ls.find((s) => s.name === 'GL.R').m, [true, true, false]);
});
