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
README.md
.gitignore
.editorconfig
```

## Udgivelse med GitHub Pages

Siden kan udgives direkte fra `main`: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, vælg `main` og `/ (root)`. Bemærk at Pages på private repos kræver et betalt GitHub-abonnement.

## Oprindelse

Værktøjet er oprindeligt lavet som et Claude-artefakt og er herfra videreudviklet i dette repo.
