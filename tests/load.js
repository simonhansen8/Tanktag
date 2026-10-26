'use strict';
// Henter beregningskernen, vinddokumentationen, samlingsmodulet og profilbiblioteket direkte fra index.html,
// så testene kører på præcis den kode, siden bruger.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const HTML_PATH = path.join(__dirname, '..', 'index.html');

function scriptBlocks(html) {
  const out = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function runModule(src, name) {
  // køres i samme realm som testen, så arrays og objekter kan sammenlignes direkte
  const module = { exports: {} };
  vm.compileFunction(src, ['module'], { filename: name })(module);
  return module.exports;
}

function load() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const blocks = scriptBlocks(html);
  const find = (marker) => {
    const b = blocks.find((s) => s.includes(marker));
    if (!b) throw new Error('Fandt ikke scriptblokken med "' + marker + '" i index.html');
    return b;
  };
  const TR = runModule(find('root.TankRoof = api'), 'index.html#TankRoof');
  const WD = runModule(find('root.TankWindDoc = api'), 'index.html#TankWindDoc');
  const TC = runModule(find('root.TankConn = api'), 'index.html#TankConn');
  const TS = runModule(find('root.TankShell = api'), 'index.html#TankShell');
  const TD = runModule(find('root.TankDsc = api'), 'index.html#TankDsc');
  const lm = /const LIB_B64 = "([^"]+)"/.exec(html);
  if (!lm) throw new Error('Fandt ikke LIB_B64 i index.html');
  const LIB = JSON.parse(zlib.inflateSync(Buffer.from(lm[1], 'base64')).toString('utf8'));
  return { TR, WD, TC, TS, TD, LIB };
}

module.exports = { load };
