# Tanktag til FEM-Design

Et browserværktøj til at modellere tanktage (fladt, konisk eller kuppel) og eksportere dem som StruXML, som FEM-Design (FD 24 / FD 25) åbner direkte.

Du indstiller radialbjælker, midterste ringbjælke, udvekslingsringe, sektionsspær, vindgitter, profiler, forbindelser, understøtninger og laster, ser modellen i plan, snit og 3D, og henter en `.struxml`-fil. Lastkombinationer kan genereres i værktøjet eller laves i FEM-Design.

Under *Søjle- og kipningslængder* angives FEM-Designs β for søjlelængde om stærk og svag akse og for kipning med trykket over- og underflange, hver for sig for radialbjælker og sektionsspær. Med fluebenet *Hele* regnes β af hele bjælkens længde i stedet for det enkelte stykke, som bjælken er delt i ved udvekslingsringene, og omregnes til stykket i filen. Værdierne skrives som `buckling_data` på stængerne.

Under Laster kan lasttilfældet *Rotationsstivhed* slås til: en prøvelast med vandrette punktlaster i valgte knuder langs udvekslingen i knuden, så taget drejer i sit eget plan om centrum. Knuderne skrives med navnene fra planen eller vælges ved at klikke i planen. Lasttilfældet skrives i StruXML-filen, men kommer ikke med i de øvrige lastkombinationer. Som standard får det sin egen kombination *Rotationsstivhed* med faktor 1 og typen anvendelse, karakteristisk, så det kan regnes ikke-lineært (NLE) i FEM-Design, uden at stålets styrkeeftervisning bruger den. Under Samlinger springes kombinationen over, når kræfterne indlæses.

## Skalmodel af radialbjælkerne

Knappen *Hent skalmodel* under tegningen henter en ekstra StruXML-fil (`…_skal.struxml`) til stabilitetsanalyse i FEM-Design, fx for at udlede knæklængdefaktorer for søjlevirkning og kipning. Filen er den samme model som den almindelige, men hver radialbjælke er tre skaller i profilets midterflader: kroppen som væg og over- og underflangen som plader, med profilets krop- og flangetykkelse. I kuplens knæk er stykkerne skåret på geringen, så skallerne deler kanter. De øvrige stænger og understøtningerne møder kroppen i systemlinjen, og dækkene fører fladelasten ned i kroppen.

Begrænsninger: kun IPE og HE-A/B/M, rodradierne er udeladt, og temperaturlasten og knæklængderne på radialbjælkerne kommer ikke med. Radialbjælkens charnier mod ringbjælken og svøbet findes ikke i skalmodellen; stængerne er forbundet til én knude i kroppen. Stabilitetsanalysen sættes op i FEM-Design.

Funktionen ligger i sin egen scriptblok (`TankShell`) i `index.html` og kan fjernes ved at slette blokken, knappen `btnShell` med dens handler, linjerne markeret `skalmodel` i `buildStruxml`, `tests/shell.test.js` (og dens linje i `tests/load.js` og `package.json`) og dette afsnit.

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

Under Samlinger vælger fanerne over *Vælg knuder*, om knuderne vælges til lastudtrækket eller til en af samling 1–7, og planen viser de knuder, der er valgt til den aktive fane. For hver samling angives også, hvilke stænger i knuden den gælder for. *Hent samlinger (Excel)* henter ét Excel-ark med tildelingen og for hver samling dens stangender; samling 1–3 (IPE 330 til tagkant, IPE 330 til ringbjælke og IPE 180 til tagkant) har også eftervisningen med formlerne i arket. Samlingerne er beskrevet i tabellen `SAMLINGER` i `index.html`.

Facit er kun så godt, som det er kontrolleret: tjek tallene mod håndberegning eller FEM-Design, før et nyt facit godkendes. Ændrede facitfiler i en PR viser præcis, hvad ændringen har flyttet. Testen kører automatisk på GitHub ved hver PR og push til `main`.

## Udgivelse med GitHub Pages

Siden kan udgives direkte fra `main`: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, vælg `main` og `/ (root)`. Bemærk at Pages på private repos kræver et betalt GitHub-abonnement.

## Oprindelse

Værktøjet er oprindeligt lavet som et Claude-artefakt og er herfra videreudviklet i dette repo.
