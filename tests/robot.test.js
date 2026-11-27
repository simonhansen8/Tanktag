'use strict';
// Eksporten til Robot (TankRobot): filen har alle stænger og knuder, og lasterne i hvert lasttilfælde har samme
// resultant som Tanktags laster (plus konstruktionens egenvægt i tilfældet af typen dead load).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./load');
const { TR, RB, LIB } = load();

const CASES = path.join(__dirname, 'cases');

function build(file) {
  const spec = JSON.parse(fs.readFileSync(path.join(CASES, file), 'utf8'));
  const params = Object.assign({}, TR.DEFAULTS, spec.params || {});
  params.combos = TR.normCombos(params.combos);
  if (spec.proposeCombos) params.combos = TR.normCombos(TR.proposeCombos(TR.computeLoads(TR.computeGeometry(params)), spec.proposeCombos));
  const geom = TR.computeGeometry(params);
  const loads = TR.computeLoads(geom);
  return { geom, loads, r: RB.buildRobotStr(TR, params, LIB, { geometry: geom, loads }) };
}

function resultant(r, ci) {
  const o = r.cases[ci], F = [0, 0, 0];
  Object.keys(o.node).forEach((no) => { for (let i = 0; i < 3; i++) F[i] += o.node[no][i]; });
  Object.keys(o.elem).forEach((no) => {
    const e = r.elems[no - 1], len = Math.hypot(...e.n2.pos.map((v, i) => v - e.n1.pos[i]));
    o.elem[no].forEach((q) => { F[{ PX: 0, PY: 1, PZ: 2 }[q.comp]] += (q.v0 + q.v1) / 2 * (q.x1 - q.x0) * len; });
  });
  return F;
}

for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith('.json')).sort()) {
  test('Robot: ' + file, () => {
    const { geom, loads, r } = build(file);
    const t = r.text;
    assert.match(t, /\r\nROBOT97\r\n/);
    assert.match(t, /\r\nEND\r\n$/);
    // alle stænger er med, og hver stang går mellem to forskellige knuder
    const real = r.elems.filter((e) => !e.aux);
    assert.ok(real.length >= geom.members.length);
    r.elems.forEach((e) => assert.notStrictEqual(e.n1, e.n2));
    const m = /NODes (\d+)  ELEments (\d+)/.exec(t);
    assert.strictEqual(Number(m[1]), r.nodes.length);
    assert.strictEqual(Number(m[2]), r.elems.length);
    // ingen tegn, som Windows-1252 ikke kan rumme
    const bytes = RB.latin1Bytes(t);
    assert.strictEqual(bytes.length, RB.robotText(t).length);
    // understøtninger: mindst én knude er understøttet
    assert.match(t, /\r\nSUPports\r\n\r\n\d/);
    // lasterne har samme resultant som i Tanktag
    const self = geom.members.reduce((s, mm) => s + TR.findSection(LIB, mm.prof || {
      radial: geom.params.profRadial, sec: geom.params.profSec, ring: geom.params.profRing, udv: geom.params.profUdv,
      edge: geom.params.profEdge, brace: geom.params.profBrace, tie: geom.params.liftTieProf }[mm.group]).area * TR.memberLength(mm), 0) * 7.85 * 9.81;
    loads.cases.forEach((c, ci) => {
      const F = resultant(r, ci), want = c.F.slice();
      if (c.type === 'dead_load') want[2] -= self;
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(F[i] - want[i]) < 1e-6 * Math.max(1, Math.abs(want[i])) + 0.02,
          c.name + ' retning ' + 'XYZ'[i] + ': ' + F[i] + ' ≠ ' + want[i]);
      }
    });
  });
}

test('Robot: profilnavne', () => {
  assert.strictEqual(RB.robotSectionName('IPE|330'), 'IPE 330');
  assert.strictEqual(RB.robotSectionName('HE-B|200'), 'HEB 200');
  assert.strictEqual(RB.robotSectionName('LE|80*6'), 'CAE 80x6');
  assert.strictEqual(RB.robotSectionName('VKR|80x80x5'), 'TCAR 80x5');
  assert.strictEqual(RB.robotSectionName('VKR|200x100x8'), 'TREC 200x100x8');
  assert.strictEqual(RB.robotSectionName('KB|T|120#1000*8'), null);
  assert.strictEqual(RB.robotMaterialName('S 355'), 'S 355');
  assert.strictEqual(RB.numList([5, 1, 2, 3, 7, 8]), '1to3 5 7to8');
});

test('Robot: gamma følger Tanktags lokale y', () => {
  // vandret stang langs X med lokal y = Y: gamma 0; lokal y = Z: gamma 90
  assert.strictEqual(RB.gammaOf([1, 0, 0], [0, 1, 0]), 0);
  assert.ok(Math.abs(RB.gammaOf([1, 0, 0], [0, 0, 1]) - 90) < 1e-9);
});
