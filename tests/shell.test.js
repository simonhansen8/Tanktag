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

// bjælkemodellen får søjle- og kipningslængder som den almindelige model, og egne kipnings-β pr. stykke til kalibreringen
test('skalmodel: kipnings-β i bjælkemodellen', () => {
  const params = Object.assign({}, TR.DEFAULTS, { bkRadialWeak: 0.5, bkRadialTopSeg: '0,9; 0,8', bkRadialBottomSeg: '; 0,7' });
  params.combos = TR.normCombos(params.combos);
  const geom = TR.computeGeometry(params);
  assert.deepEqual(geom.errors, []);
  const bar = (xml, name) => xml.split('<bar ').find((b) => b.startsWith('name="' + name + '"'));
  const beta = (b, type) => Number(new RegExp('type="' + type + '" beta="([^"]+)"').exec(b)[1]);

  // uden egne værdier: som i den almindelige model
  const plain = TS.buildRafterStruxml(TR, geom, LIB, TS.options({}, geom).o).xml;
  wellFormed(plain);
  const b11 = bar(plain, 'RBB1.1'), b12 = bar(plain, 'RBB1.2'), b13 = bar(plain, 'RBB1.3');
  assert.deepEqual([beta(b11, 'flexural_stiff'), beta(b11, 'flexural_weak'), beta(b11, 'pressured_flange'), beta(b11, 'pressured_bottom_flange')], [1, 0.5, 0.9, 1]);
  assert.deepEqual([beta(b12, 'pressured_flange'), beta(b12, 'pressured_bottom_flange')], [0.8, 0.7]);
  assert.match(b11, /<\/eccentricity>\s*<buckling_data>[\s\S]*load_position="top" continously_restrained="false"[\s\S]*<\/buckling_data>\s*<end\/>/);

  // egne værdier fra fanen Skalmodel går forud; tomme pladser følger den almindelige model
  const op = TS.options({ bkTopSeg: ' ; ; 1,3', bkBottomSeg: '0,6', qPos: 'centre' }, geom);
  assert.deepEqual(op.errors, []);
  const own = TS.buildRafterStruxml(TR, geom, LIB, op.o).xml;
  assert.deepEqual([beta(bar(own, 'RBB1.1'), 'pressured_flange'), beta(bar(own, 'RBB1.2'), 'pressured_flange'), beta(bar(own, 'RBB1.3'), 'pressured_flange')], [0.9, 0.8, 1.3]);
  assert.deepEqual([beta(bar(own, 'RBB1.1'), 'pressured_bottom_flange'), beta(bar(own, 'RBB1.2'), 'pressured_bottom_flange')], [0.6, 0.7]);
  assert.equal(beta(bar(own, 'RBB1.3'), 'pressured_bottom_flange'), beta(b13, 'pressured_bottom_flange'));
  // lastens angrebspunkt følger skalmodellens linjelast
  assert.ok(bar(own, 'RBB1.1').includes('load_position="center"'));
  // kun bjælkemodellen ændres: den almindelige models parametre er de samme
  assert.equal(geom.params.bkRadialTopSeg, '0,9; 0,8');
  const bp = TS.beamParams(TR, geom.params, op.o);
  assert.equal(bp.bkRadialTopSeg, '0,9; 0,8; 1,3');
  assert.equal(bp.bkRadialBottomSeg, '0,6; 0,7');

  // ugyldige værdier
  const bad = TS.options({ bkTopSeg: '0; 1', bkBottomSeg: 'x' }, geom);
  assert.equal(bad.errors.length, 2, bad.errors.join(' | '));
});
