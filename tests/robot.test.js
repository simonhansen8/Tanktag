'use strict';
// Eksporten til Robot (TankRobot): modellen har alle stænger og knuder, lasterne i hvert lasttilfælde har samme
// resultant som Tanktags laster, og scriptet har de forventede dele.
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
  return { geom, loads, r: RB.buildRobotScript(TR, params, LIB, { geometry: geom, loads, name: 'test' }) };
}

// lasternes resultant i kN (punktlaster og linjelaster; egenvægten regner Robot selv)
function resultant(M, ci) {
  const C = M.cases[ci], F = [0, 0, 0];
  Object.keys(C.nodes).forEach((no) => { for (let i = 0; i < 3; i++) F[i] += C.nodes[no][i]; });
  Object.keys(C.bars).forEach((k) => {
    const q = C.bars[k], e = q.e, len = Math.hypot(...e.n2.pos.map((v, i) => v - e.n1.pos[i]));
    for (let i = 0; i < 3; i++) F[i] += (q.v0[i] + q.v1[i]) / 2 * (q.x1 - q.x0) * len;
  });
  return F;
}

for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith('.json')).sort()) {
  test('Robot: ' + file, () => {
    const { geom, loads, r } = build(file);
    const M = r.model, t = r.text;
    // .cmd-delen starter PowerShell med resten af filen
    assert.match(t, /^@echo off\r\n/);
    assert.strictEqual(t.split('#POWERSHELL#').length, 2, 'markøren står kun én gang som linje');
    assert.match(t, /\$app\.Project\.SaveAs\(\$Rtd\)/);
    // alle stænger er med, og hver stang går mellem to forskellige knuder
    assert.ok(M.elems.length >= geom.members.length);
    M.elems.forEach((e) => assert.notStrictEqual(e.n1, e.n2));
    assert.strictEqual((t.match(/\$cache\.AddNode\(/g) || []).length, M.nodes.length);
    assert.strictEqual((t.match(/\$cache\.AddBar\(/g) || []).length, M.elems.length);
    // understøtninger og lasttilfælde
    assert.ok(M.supports.length > 0);
    assert.strictEqual((t.match(/\$cases\.CreateSimple\(/g) || []).length, loads.cases.length);
    assert.strictEqual((t.match(/\$cases\.CreateCombination\(/g) || []).length, (loads.combos || []).filter((c) => c.export).length);
    // lasterne har samme resultant som i Tanktag
    loads.cases.forEach((c, ci) => {
      const F = resultant(M, ci);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(F[i] - c.F[i]) < 1e-6 * Math.max(1, Math.abs(c.F[i])) + 0.02,
          c.name + ' retning ' + 'XYZ'[i] + ': ' + F[i] + ' ≠ ' + c.F[i]);
      }
      assert.strictEqual(M.cases[ci].dead, c.type === 'dead_load');
      const nT = c.loads.filter((Ld) => Ld.kind === 'temp').length, nM = c.loads.filter((Ld) => Ld.kind === 'motion').length;
      assert.strictEqual(Object.keys(M.cases[ci].temps).length > 0, nT > 0);
      assert.strictEqual(Object.keys(M.cases[ci].motions).length > 0, nM > 0);
    });
  });
}

test('Robot: profilnavne', () => {
  assert.deepStrictEqual(RB.robotSectionNames('IPE|330'), ['IPE 330']);
  assert.deepStrictEqual(RB.robotSectionNames('HE-B|200'), ['HEB 200']);
  assert.deepStrictEqual(RB.robotSectionNames('LE|80*6'), ['CAE 80x6', 'L 80x6']);
  assert.deepStrictEqual(RB.robotSectionNames('VKR|80x80x5'), ['TCAR 80x5', 'SHS 80x80x5']);
  assert.deepStrictEqual(RB.robotSectionNames('VKR|200x100x8'), ['TREC 200x100x8', 'RHS 200x100x8']);
  assert.deepStrictEqual(RB.robotSectionNames('KB|T|120#1000*8'), []);
  assert.strictEqual(RB.customSectionName('KB|T|120#1000*8'), 'KB_T120_1000x8');
  assert.strictEqual(RB.numList([5, 1, 2, 3, 7, 8]), '1to3 5 7to8');
});

test('Robot: tværsnitsværdier af omridset', () => {
  // IPE 330: A = 62,6 cm², Iy = 11770 cm⁴, Iz = 788 cm⁴, Wpl,y = 804 cm³ (profiltabel)
  const p = RB.sectionProps(TR, TR.findSection(LIB, 'IPE|330'));
  assert.ok(Math.abs(p.A / 62.6e-4 - 1) < 0.01, 'A ' + p.A);
  assert.ok(Math.abs(p.Iy / 11770e-8 - 1) < 0.01, 'Iy ' + p.Iy);
  assert.ok(Math.abs(p.Iz / 788e-8 - 1) < 0.02, 'Iz ' + p.Iz);
  assert.ok(Math.abs(p.Wply / 804e-6 - 1) < 0.03, 'Wpl,y ' + p.Wply);
  assert.ok(Math.abs(p.vz - 0.165) < 1e-4 && Math.abs(p.vpz - 0.165) < 1e-4);
});

test('Robot: gamma følger Tanktags lokale y', () => {
  assert.strictEqual(RB.gammaOf([1, 0, 0], [0, 1, 0]), 0);
  assert.ok(Math.abs(RB.gammaOf([1, 0, 0], [0, 0, 1]) - 90) < 1e-9);
});
