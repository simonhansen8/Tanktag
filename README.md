# Tanktag til FEM-Design

Et browserværktøj til at modellere tanktage (fladt, konisk eller kuppel) og eksportere dem som StruXML, som FEM-Design (FD 24 / FD 25) åbner direkte.

Du indstiller radialbjælker, midterste ringbjælke, udvekslingsringe, sektionsspær, vindgitter, profiler, forbindelser, understøtninger og laster, ser modellen i plan, snit og 3D, og henter en `.struxml`-fil. Lastkombinationer kan genereres i værktøjet eller laves i FEM-Design.

## Kom i gang

Værktøjet er én selvstændig HTML-fil uden build-trin.

- Åbn `index.html` direkte i en browser, eller
- kør en lokal server fra mappen, fx `python3 -m http.server 8000`, og gå til <http://localhost:8000>.

Den eneste eksterne afhængighed er skrifttyperne fra Google Fonts; uden netværk falder siden tilbage til systemskrifter. Profilbiblioteket er indlejret i filen. Indstillingerne gemmes i browserens `localStorage`.

## Struktur

```
index.html      Hele værktøjet: HTML, CSS, JavaScript og indlejret profilbibliotek
tests/          Regressionstest af beregningskernen (Node, ingen afhængigheder)
package.json    npm-scripts til testen
README.md
.gitignore
.editorconfig
```

## Regressionstest

Testen kører beregningskernen fra `index.html` i Node på en række referencetage og sammenligner med gemte facit. Den fanger, hvis en ændring utilsigtet flytter geometri, mængder, laster, lastkombinationer, last- og vinddokumentationen, den eksporterede StruXML eller de dimensionerende snitkræfter under Samlinger.

```
npm test             # sammenlign med facit
npm run test:update  # skriv nyt facit efter en tilsigtet ændring
```

- `tests/cases/*.json`: referencetagene, som afvigelser fra standardparametrene. Læg en ny fil her for at teste et nyt tag.
- `tests/snapshots/<tag>.json`: oversigt over geometri, mængder, lasttilfælde med resultanter og kombinationer.
- `tests/snapshots/<tag>.vind.txt` og `<tag>.laster.txt`: vind- og lastdokumentationen som tekst.
- `tests/snapshots/<tag>.struxml.gz`: hele StruXML-filen med faste GUID'er og tidsstempel.
- `tests/fixtures/endelaster.txt.gz`: en rigtig liste *Bars, End forces* fra FEM-Design for standardtaget. `tests/conn.test.js` læser den, kontrollerer at *Internal forces* og en dansk Excel-CSV giver det samme, og sammenligner de dimensionerende tilfælde med `tests/snapshots/samlinger-endelaster.csv`.

Under Samlinger kan *Hent samling 1 (Excel)* hente et Excel-ark med eftervisningen af samling 1 (IPE 330 til tagkant) for alle knuder og kombinationer. Formlerne står i arket, og fanen *Kræfter* kan fyldes med en ny CSV fra *Hent alle stangender*.

Facit er kun så godt, som det er kontrolleret: tjek tallene mod håndberegning eller FEM-Design, før et nyt facit godkendes. Ændrede facitfiler i en PR viser præcis, hvad ændringen har flyttet. Testen kører automatisk på GitHub ved hver PR og push til `main`.

## Udgivelse med GitHub Pages

Siden kan udgives direkte fra `main`: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, vælg `main` og `/ (root)`. Bemærk at Pages på private repos kræver et betalt GitHub-abonnement.

## Oprindelse

Værktøjet er oprindeligt lavet som et Claude-artefakt og er herfra videreudviklet i dette repo.
