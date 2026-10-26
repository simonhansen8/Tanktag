'use strict';
// Rapportskabelonen til FEM-Design (TankDsc): lastdokumentationen bliver til afsnit og tekstbokse uden at tabe tekst,
// og afsnittene sættes ind sidst i en grundskabelon fra FEM-Design.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./load');

const { TD } = load();
const SNAP_DIR = path.join(__dirname, 'snapshots');
const texts = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.laster.txt'))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(SNAP_DIR, f), 'utf8') }));

function unXml(s) {
  return s.replace(/&#13;&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/%%/g, '%');
}
// elementerne åbnes og lukkes i rækkefølge
function balanced(xml) {
  const stack = [], re = /<(\/?)([a-zA-Z_][\w]*)[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

test('lastdokumentationen findes', () => assert.ok(texts.length > 0));

for (const { name, text } of texts) {
  test('rapportskabelon: ' + name, () => {
    const blocks = TD.parseText(text);
    const underlines = text.split('\n').filter((l) => /^(={3,}|-{3,})$/.test(l.trim())).length;
    assert.equal(blocks.filter((b) => b.type === 'heading').length, underlines, 'alle overskrifter bliver til afsnit');
    // al tekst kommer med: overskrifter og blokke giver de samme ikke-tomme linjer som teksten uden understregninger
    const want = text.split('\n').filter((l, i, a) => l.trim() && !/^(={3,}|-{3,})$/.test(l.trim())).map((l) => l.trim());
    const got = [].concat(...blocks.map((b) => b.type === 'heading' ? [b.title] : b.text.split('\n'))).map((l) => l.trim());
    assert.deepEqual(got, want);
    assert.ok(blocks.some((b) => b.type === 'table'), 'tabellerne genkendes');

    const xml = TD.buildDsc([{ title: 'Laster på tanktaget', text }], '');
    assert.ok(xml.startsWith('<?xml') && xml.endsWith('<cmdendsession/></fdscript>'));
    assert.ok(balanced(xml), 'XML er velformet');
    assert.ok(!/[^%]%[^%]/.test(xml.replace(/%%/g, '')), 'procenttegn er fordoblet');
    const boxes = [...xml.matchAll(/<text>([\s\S]*?)<\/text>/g)].map((m) => unXml(m[1]));
    assert.deepEqual(boxes, blocks.filter((b) => b.type !== 'heading').map((b) => b.text));
  });
}

test('afsnittene sættes ind før cmdendsession i grundskabelonen', () => {
  const base = '<?xml version="1.0" encoding="UTF-8"?><fdscript><fdscriptheader><version>2500</version></fdscriptheader>' +
    '<cmddoccontent command="; CXL DOC CONTENTS"/><cmdendsession/></fdscript>';
  const xml = TD.buildDsc([{ title: 'A & B 5%', text: 'Afsnit\n======\nTekst' }], base);
  assert.ok(balanced(xml));
  assert.ok(xml.indexOf('<cmddoccontent') < xml.indexOf('<cmddocchapter') && xml.lastIndexOf('<cmddoctextbox') < xml.indexOf('<cmdendsession'));
  assert.ok(xml.includes('<title>A &amp; B 5%%</title>'));
  assert.throws(() => TD.buildDsc([], '<ikke-et-script/>'));
});
