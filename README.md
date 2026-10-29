# Tanktag til FEM-Design

Et browserværktøj til at modellere tanktage (fladt, konisk eller kuppel) og eksportere dem som StruXML, som FEM-Design (FD 24 / FD 25) åbner direkte.

Du indstiller radialbjælker, midterste ringbjælke, udvekslingsringe, sektionsspær, vindgitter, profiler, forbindelser, understøtninger og laster, ser modellen i plan, snit og 3D, og henter en `.struxml`-fil. Lastkombinationer kan genereres i værktøjet eller laves i FEM-Design.

Under *Søjle- og kipningslængder* angives FEM-Designs β for søjlelængde om stærk og svag akse og for kipning med trykket over- og underflange, hver for sig for radialbjælker og sektionsspær. Med fluebenet *Hele* regnes β af hele bjælkens længde i stedet for det enkelte stykke, som bjælken er delt i ved udvekslingsringene, og omregnes til stykket i filen. Værdierne skrives som `buckling_data` på stængerne. For kipning kan enheden under feltet sættes til *m* i stedet for *β*: så er tallet kipningslængden L<sub>cr</sub> i meter (fx fra β-kalibreringsarket), og hvert stykke får β = L<sub>cr</sub> / stykkets længde (parametrene `bkRadialTopUnit`, `bkRadialBottomUnit`, `bkSecTopUnit` og `bkSecBottomUnit` = `'beta'` eller `'m'`).

Under Laster kan lasttilfældet *Rotationsstivhed* slås til: en prøvelast med vandrette punktlaster i valgte knuder langs udvekslingen i knuden, så taget drejer i sit eget plan om centrum. Knuderne skrives med navnene fra planen eller vælges ved at klikke i planen. Lasttilfældet skrives i StruXML-filen, men kommer ikke med i de øvrige lastkombinationer. Som standard får det sin egen kombination *Rotationsstivhed* med faktor 1 og typen anvendelse, karakteristisk, så det kan regnes ikke-lineært (NLE) i FEM-Design, uden at stålets styrkeeftervisning bruger den. Under Samlinger springes kombinationen over, når kræfterne indlæses.

Under Laster kan lasttilfældet *Kipning* også slås til: en prøvelast med en lodret linjelast på hele den valgte radialbjælke fra ringbjælken til svøbet, standard 1 kN/m på den skrå længde, så momentkurven kan aflæses, når kipningslængderne sættes (fx M<sub>max</sub> til skalmodellens regneark). Lasten kan ændres, og en negativ værdi løfter spæret. Lasttilfældet skrives i StruXML-filen, men kommer ikke med i nogen lastkombination.

## Skalmodel af én radialbjælke

Knappen *Hent skalmodel* under tegningen henter en lille StruXML-fil (`…_skal_RB1.struxml`) med radialbjælke RB.1 alene, til stabilitetsanalyse i FEM-Design. Ud fra de kritiske laster kan søjle- og kipningslængderne til den almindelige model udledes.

Fanen *Skalmodel* har skalmodellens indstillinger: hvilken radialbjælke, elementstørrelse, endeplader, lejerne i hver ende (på tværs og om den stærke akse) og om de er punkt- eller linjeunderstøtninger, hvor bjælken er fastholdt aksialt, sidefastholdelsen ved udvekslingerne (topflange, systemlinje, bundflange eller ingen, hvilke ringe og evt. som fjeder), hvilke lasttilfælde der kommer med, N og q og linjelastens angrebspunkt. Standardværdierne er beskrevet herunder. Indstillingerne gemmes i browseren for sig og kommer ikke med i *Kopiér parametre*.

- **Bjælken**: krop, overflange og underflange som skaller i profilets midterflader, med profilets krop- og flangetykkelse. Den deles som i taget, og i kuplens knæk er stykkerne skåret på geringen, så skallerne deler kanter. Kun IPE og HE-A/B/M, og rodradierne er udeladt.
- **Understøtninger**: som standard gaffellejer i begge ender. Kroppens endekant er altid fastholdt i sin retning (i midten, over- og underkanten). På tværs vælges for hver ende mellem *gaffelleje* (over- og underkanten fastholdt på tværs, så tværsnittet hverken flytter sig til siden eller vrider om sin egen akse), *sidefastholdt* (kun midten på tværs, fri vridning) og *fri på tværs*. Om den stærke akse er bjælken som standard fri, men hver ende kan indspændes (over- og underkanten også fastholdt i bjælkens retning, hvilket også fastholder den aksialt i den ende). Bjælken er altid fri for hvælving og som standard kun fastholdt aksialt ved ringbjælken. Valgene gælder også bjælkemodellen, hvor de er fastholdte flytninger og rotationer i endeknuden. Fastholdelserne i skalmodellen kan også laves som *linjeunderstøtninger* i stedet for punkter: kroppens endekant bliver én linje (i sin retning, på tværs ved gaffelleje, aksialt ved indspænding), og sidefastholdelsen i top- eller bundflangen en linje på tværs af flangen (en fjederstivhed fordeles over flangebredden). Aksial fastholdelse uden indspænding og *sidefastholdt* er et punkt midt på endekanten, og sidefastholdelse i systemlinjen forbliver et punkt, så den ikke fastholder mod vridning. Ved hver udvekslingsring er topflangen fastholdt på tværs, fordi udvekslingerne er monteret der.
- **Laster**: tre enhedslaster, hver med sin egen kombination: *Tryk N* (1 kN jævnt fordelt over endetværsnittene, og i knækkene afbøjningskraften, så hvert stykke har rent normalkraft), *Last ned på overflange* og *Last op på overflange* (1 kN/m lodret langs overflangens midte pr. meter bjælke). FEM-Designs kritiske lastfaktor er derfor den kritiske last i kN eller kN/m.

- **Bjælkemodel ved siden af**: samme spær som almindelige stænger (RBB…), som standard 3 m vandret på tværs af spæret, med de samme lejer og laster i egne lasttilfælde og kombinationer (*… – bjælkemodel*), så momentet kan aflæses på stængerne uden at blande sig i skallens egenformer. Linjelasten og sidefastholdelsen sidder i systemlinjen. Afstanden sættes på fanen, 0 = ingen.
- **β-kalibreringsark**: knappen *Hent β-kalibreringsark* henter et Excel-ark til kalibrering af kipnings-β for over- og underflange (`…_beta_kipning_RB1.xlsx`). Arket er udfyldt for bjælken på fanen: antal sektioner, samlet længde og stykkernes længder, styrende sektion (stykket midt på spæret, hvor momentet er størst ved jævn last), start-β fra modellens kipningslængder og navnene på de lasttilfælde, tallene aflæses i. Kritisk lastfaktor α<sub>cr</sub> og M<sub>Ed,max</sub> udfyldes selv, og kalibreringen køres i arket. Skabelonen ligger i `index.html` som `BETA_XLSX_B64`.

β for søjlevirkning følger af N_cr = π²EI/(βL)², hvor L er stykkets længde (står i statuslinjen, når filen hentes). For kipning sammenlignes M_cr fra lasten nedad (trykket overflange) og opad (trykket underflange) med FEM-Designs kipningsformel for den samme bjælke.

Funktionen ligger i sin egen scriptblok (`TankShell`) i `index.html` og bruger ikke den almindelige eksport. Den fjernes ved at slette blokken, knappen `btnShell`, fanen `ftab-shell`/`pane-shell` med dens handler og linjerne markeret `skalmodel`, `tests/shell.test.js` (og dens linjer i `tests/load.js` og `package.json`) og dette afsnit.

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
