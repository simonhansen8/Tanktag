'use strict';
// Skalmodellen (TankShell): radialbjælkerne som skaller. Kontrollerer, at skallerne hænger sammen, at de øvrige
// stænger og understøtninger møder kroppen, og at resten af filen er den samme som den almindelige StruXML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./load');

const { TR, TS, LIB } = load();
const CASES_DIR = path.join(__dirname, 'cases');
const TOL = 1e-6;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dist(a, b) { return Math.hypot(...sub(a, b)); }
function same(a, b) { return dist(a, b) < TOL; }
function sameEdge(e, f) { return (same(e[0], f[0]) && same(e[1], f[1])) || (same(e[0], f[1]) && same(e[1], f[0])); }

// punktet q ligger i den plane firkant P (indenfor eller på kanten)
function onQuad(q, P) {
  const n = cross(sub(P[1], P[0]), sub(P[3], P[0])), ln = Math.hypot(...n);
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

function build(params, geom, shell) {
  let guid = 0;
  return TR.buildStruxml(params, LIB, {
    geometry: geom,
    timestamp: '2000-01-01T00:00:00.000',
    guid: () => '00000000-0000-4000-8000-' + String(++guid).padStart(12, '0'),
    shell
  });
}

fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort().forEach((file) => {
  const spec = JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8'));
  const params = Object.assign({}, TR.DEFAULTS, spec.params);
  params.combos = TR.normCombos(params.combos);

  test('skalmodel: ' + file, () => {
    const geom = TR.computeGeometry(params);
    const shell = TS.radialShells(TR, geom, LIB);
    const xml = build(params, geom, shell);
    const plain = build(params, TR.computeGeometry(params), null);
    const radial = geom.members.filter((m) => m.group === 'radial');

    // hver radialbjælke er tre skaller; ingen stænger tilbage for dem
    assert.equal(shell.pieces.length, radial.length);
    assert.equal((xml.match(/<slab /g) || []).length, 3 * radial.length);
    assert.equal((xml.match(/<slab_part /g) || []).length, 3 * radial.length);
    radial.forEach((m) => assert.ok(!xml.includes('<bar name="' + m.name + '"'), m.name + ' står stadig som stang'));
    assert.equal((xml.match(/<bar /g) || []).length, (plain.match(/<bar /g) || []).length - radial.length);
    // elementerne er korrekt indlejret
    wellFormed(xml);

    // laster, kombinationer og understøtninger er de samme som i den almindelige fil
    ['point_load', 'line_load', 'surface_load', 'load_case', 'load_combination', 'point_support', 'cover'].forEach((tag) => {
      const re = new RegExp('<' + tag + ' ', 'g');
      assert.equal((xml.match(re) || []).length, (plain.match(re) || []).length, tag);
    });

    const webs = shell.pieces.map((pc) => pc.plates[0].pts);
    shell.pieces.forEach((pc) => {
      const [web, top, bot] = pc.plates;
      assert.equal(web.t, shell.dims.tw);
      assert.equal(top.t, shell.dims.tf);
      // kroppen er lodret (skrives som væg), og alle fire hjørner ligger i én plan
      const n = cross(sub(web.pts[1], web.pts[0]), sub(web.pts[3], web.pts[0]));
      assert.ok(Math.abs(n[2]) / Math.hypot(...n) < 1e-9, 'kroppen er ikke lodret');
      pc.plates.forEach((pl) => {
        const nn = cross(sub(pl.pts[1], pl.pts[0]), sub(pl.pts[3], pl.pts[0]));
        assert.ok(Math.abs(dot(sub(pl.pts[2], pl.pts[0]), nn)) / Math.hypot(...nn) < 1e-9, 'skallen er ikke plan');
      });
      // kroppens over- og underkant ligger midt i flangerne, og systemlinjen midt i kroppen
      assert.ok(onQuad(web.pts[2], top.pts) && onQuad(web.pts[3], top.pts));
      assert.ok(onQuad(web.pts[0], bot.pts) && onQuad(web.pts[1], bot.pts));
      assert.ok(onQuad(pc.member.start, web.pts) && onQuad(pc.member.end, web.pts));
    });

    // nabostykker af samme radialbjælke deler endekanterne (geringssnit i knækkene)
    shell.pieces.forEach((pc, i) => {
      shell.pieces.forEach((qc, j) => {
        if (i === j || pc.member.index !== qc.member.index || !same(pc.member.end, qc.member.start)) return;
        for (let k = 0; k < 3; k++) {
          const P = pc.plates[k].pts, Q = qc.plates[k].pts;
          assert.ok(sameEdge([P[1], P[2]], [Q[0], Q[3]]), pc.member.name + '/' + qc.member.name + ' skal ' + k + ' hænger ikke sammen');
        }
      });
    });

    // de øvrige stænger og understøtningerne, der rører en radialbjælke, ender på dens krop
    const radialNodes = [];
    radial.forEach((m) => radialNodes.push(m.start, m.end));
    const onRadialLine = (q) => radial.some((m) => {
      const d = sub(m.end, m.start), t = dot(sub(q, m.start), d) / dot(d, d);
      return t > -TOL && t < 1 + TOL && dist(q, [m.start[0] + t * d[0], m.start[1] + t * d[1], m.start[2] + t * d[2]]) < TOL;
    });
    let touching = 0;
    geom.members.filter((m) => m.group !== 'radial').forEach((m) => {
      [m.start, m.end].forEach((q) => {
        if (!onRadialLine(q)) return;
        touching++;
        assert.ok(webs.some((w) => onQuad(q, w)), m.name + ' ender ikke på en krop');
      });
    });
    geom.supports.forEach((s) => { if (onRadialLine(s.pos)) assert.ok(webs.some((w) => onQuad(s.pos, w)), s.name); });
    assert.ok(touching > 0);

    // dækkene bærer på kroppene og de øvrige stænger: alle henvisninger peger på en del i filen
    const parts = new Set();
    (xml.match(/<(bar|slab)_part guid="[^"]+"/g) || []).forEach((t) => parts.add(/guid="([^"]+)"/.exec(t)[1]));
    const refs = xml.match(/<ref guid="[^"]+"/g) || [];
    assert.ok(refs.length > 0);
    refs.forEach((t) => assert.ok(parts.has(/guid="([^"]+)"/.exec(t)[1]), 'dækket henviser til en del, der ikke findes'));
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
