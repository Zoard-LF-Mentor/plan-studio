// Contrôle src/plan.json, puis génère le site dans dist/.  Usage : node build.mjs
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = (...parts) => path.join(root, "src", ...parts);
const out = (...parts) => path.join(root, "dist", ...parts);

const plan = JSON.parse(await readFile(src("plan.json"), "utf8"));
const genereLe = new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date());
await import("./src/tools.js");
const T = globalThis.StudioTools;
const { esc, norm } = T;

// ---------------------------------------------------------------- données

const fiches = plan.fiches;
const byId = new Map(fiches.map((f) => [f.id, f]));
const childMap = new Map();
for (const f of fiches) {
  const key = f.parent ?? "";
  if (!childMap.has(key)) childMap.set(key, []);
  childMap.get(key).push(f);
}
const kids = (id = "") => childMap.get(id) ?? [];
const pathTo = (id) => {
  const trail = [];
  for (let node = byId.get(id); node && !trail.includes(node); node = byId.get(node.parent)) trail.unshift(node);
  return trail;
};
const trail = (id, upTo) => pathTo(id).slice(0, upTo).map((n) => n.titre).join(" › ");
const order = [];
(function walk(parent) {
  for (const node of kids(parent)) {
    order.push(node);
    walk(node.id);
  }
})("");
const countUnder = (id) => kids(id).reduce((sum, n) => sum + 1 + countUnder(n.id), 0);
const pointsOf = (f) => (f.blocs ?? []).flatMap((bloc, b) =>
  bloc.points.map((point, p) => ({ bloc, point, anchor: `b${b + 1}-p${p + 1}` })));
const E = plan.etiquettes;
// Une règle sans source liée est une règle fixée par le studio, pas une règle documentée.
const etatDe = (point) => (point.etat === "regle" && !point.references?.length ? "regle_studio" : point.etat);
const famille = (point) => E[etatDe(point)][1];
const hasOpen = (f) => f.etat === "open" || pointsOf(f).some(({ point }) => point.etat === "ouvert");
const source = (id) => plan.sources_documentaires[id];
const RESERVED = ["index", "guide", "decisions", "sources"];

// ------------------------------------------------------------- validation

const errors = [];
const seen = new Set();
const cited = new Set();
for (const f of fiches) {
  if (!/^[a-z0-9-]+$/.test(f.id ?? "")) errors.push(`Identifiant invalide : ${f.id}`);
  if (seen.has(f.id) || RESERVED.includes(f.id)) errors.push(`Identifiant en double ou réservé : ${f.id}`);
  seen.add(f.id);
  for (const key of ["titre", "intro", "direction"]) {
    if (typeof f[key] !== "string" || !f[key].trim()) errors.push(`${f.id} : « ${key} » manquant`);
  }
  if (f.parent && !byId.has(f.parent)) errors.push(`${f.id} : parent inconnu « ${f.parent} »`);
  if (f.etat && !["open", "closed"].includes(f.etat)) errors.push(`${f.id} : état inconnu « ${f.etat} »`);
  if (f.etat && !f.statut) errors.push(`${f.id} : un état demande un statut`);
  if (f.liens && !f.liens.length) errors.push(`${f.id} : liste de liens vide`);
  const cibles = new Set();
  for (const link of f.liens ?? []) {
    if (!byId.has(link.id)) errors.push(`${f.id} : lien vers une fiche inconnue « ${link.id} »`);
    if (link.id === f.id) errors.push(`${f.id} : lien vers elle-même`);
    if (cibles.has(link.id)) errors.push(`${f.id} : deux liens vers « ${link.id} »`);
    cibles.add(link.id);
  }
  const titres = new Set();
  for (const { point } of pointsOf(f)) {
    if (!E[point.etat]) errors.push(`${f.id} · ${point.titre} : étiquette inconnue « ${point.etat} »`);
    if (titres.has(point.titre)) errors.push(`${f.id} : le point « ${point.titre} » figure deux fois`);
    titres.add(point.titre);
    for (const ref of point.references ?? []) {
      if (!source(ref)) errors.push(`${f.id} · ${point.titre} : source inconnue « ${ref} »`);
      cited.add(ref);
    }
  }
  for (const ref of f.bibliographie ?? []) {
    if (!source(ref)) errors.push(`${f.id} : source inconnue « ${ref} »`);
    cited.add(ref);
  }
  for (const s of f.sources ?? []) if (!s.url?.startsWith("https://")) errors.push(`${f.id} : adresse de source invalide`);
}
if (order.length !== fiches.length) errors.push("Arborescence : une fiche est hors de l’arbre ou forme une boucle.");
for (const format of plan.quiz_formats) {
  for (const ref of format.references) {
    if (!source(ref)) errors.push(`Format ${format.id} : source inconnue « ${ref} »`);
    cited.add(ref);
  }
  if (!T.revelationsFormat.includes(format.revelation)) errors.push(`Format ${format.id} : révélation inconnue « ${format.revelation} »`);
  if (!T.reponsesFormat.includes(format.reponses)) errors.push(`Format ${format.id} : mode de réponse inconnu « ${format.reponses} »`);
}
const adresses = new Map();
for (const [id, s] of Object.entries(plan.sources_documentaires)) {
  if (!s.url?.startsWith("https://")) errors.push(`Source ${id} : adresse invalide`);
  if (!cited.has(id)) errors.push(`Source ${id} : citée nulle part`);
  const cle = (s.url ?? "").replace(/\/amp\/?$/, "/").replace(/\/$/, "");
  if (adresses.has(cle)) errors.push(`Sources ${adresses.get(cle)} et ${id} : même adresse`);
  adresses.set(cle, id);
}
for (const [id] of plan.parcours) if (!byId.has(id)) errors.push(`Parcours : fiche inconnue « ${id} »`);
for (const [ancien, cible] of Object.entries(plan.alias)) {
  if (byId.has(ancien)) errors.push(`Alias « ${ancien} » : une fiche porte déjà cet identifiant`);
  if (!byId.has(cible) && !RESERVED.includes(cible)) errors.push(`Alias « ${ancien} » : cible inconnue « ${cible} »`);
}
if (!byId.has(plan.autonomie.origine)) errors.push("Autonomie : fiche d’origine inconnue");
if (plan.autonomie.criteres.reduce((sum, [, max]) => sum + max, 0) !== 100) errors.push("Autonomie : le total des critères doit faire 100");
for (const [etat, [, fam]] of Object.entries(E)) if (!plan.familles[fam]) errors.push(`Étiquette ${etat} : famille inconnue « ${fam} »`);
if (errors.length) {
  console.error("Le plan contient " + errors.length + " erreur(s) :\n- " + errors.join("\n- "));
  process.exit(1);
}

// ------------------------------------------------------- vues transversales

const groupes = [
  { id: "studio", titre: "À décider par le studio", court: "à décider par le studio", texte: "Ces décisions appartiennent au studio. Tant qu’elles restent ouvertes, les fiches qui en dépendent attendent.", items: [] },
  { id: "condition", titre: "À vérifier avant d’en tenir compte", court: "à vérifier avant usage", texte: "Ces points dépendent d’un compte, d’un pays, d’un programme ou d’un titulaire de droits. Relever la preuve avant de s’y appuyer.", items: [] },
  { id: "annonce", titre: "Annonces à revalider", court: "annonce à revalider", texte: "Changements annoncés par une plateforme. Revalider la règle avant tout scénario.", items: [] },
  { id: "essai", titre: "À éprouver par un essai", court: "à éprouver par un essai", texte: "Hypothèses qu’un essai doit confirmer.", items: [] },
];
const groupOf = { ouvert: 0, condition: 1, annonce: 2, hypothese: 3 };
for (const f of order) {
  if (f.etat === "open") groupes[0].items.push({ titre: f.titre, tag: f.statut, texte: f.direction, fiche: f, url: `${f.id}.html` });
  for (const { point, anchor } of pointsOf(f)) {
    if (point.etat in groupOf) {
      groupes[groupOf[point.etat]].items.push({ titre: point.titre, tag: E[point.etat][0], texte: point.texte, fiche: f, url: `${f.id}.html#${anchor}` });
    }
  }
}

const closes = order.filter((f) => f.etat === "closed");

const usages = new Map(Object.keys(plan.sources_documentaires).map((id) => [id, new Set()]));
for (const f of order) {
  for (const { point } of pointsOf(f)) for (const ref of point.references ?? []) usages.get(ref).add(f);
  if (f.comparateurQuiz) for (const format of plan.quiz_formats) for (const ref of format.references) usages.get(ref).add(f);
}
const quizFormats = plan.quiz_formats.map((format) => ({
  ...format,
  appuis: format.references.map(source).map(({ titre, url }) => ({ titre, url })),
}));

// ------------------------------------------------------------- fragments

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true">
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6"/></symbol>
<symbol id="i-back" viewBox="0 0 24 24"><path d="M20 12H5m6 6-6-6 6-6"/></symbol>
<symbol id="i-diagonal" viewBox="0 0 24 24"><path d="M6 18 18 6M7 6h11v11"/></symbol>
<symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.2"/><path d="m15 15 4.3 4.3"/></symbol>
<symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
<symbol id="i-chaines" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="9.5" height="7" rx="1.25"/><path d="M7.5 11.5v6a2 2 0 0 0 2 2H13"/><rect x="13" y="15.5" width="7.5" height="6" rx="1.25"/><path d="M13 8h7.5"/></symbol>
<symbol id="i-argent" viewBox="0 0 24 24"><ellipse cx="11.5" cy="6.4" rx="7" ry="2.9"/><path d="M4.5 6.4v5.5c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.4M4.5 11.9v5.5c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9v-5.5"/></symbol>
<symbol id="i-preparation" viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="m8 9 1.3 1.3L12 7.7M14 9h2m-8 6.5 1.3 1.3 2.7-2.6m2 1.3h2"/></symbol>
<symbol id="i-automatisation" viewBox="0 0 24 24"><rect x="8.5" y="3" width="7" height="6" rx="1.3"/><rect x="3" y="15" width="7" height="6" rx="1.3"/><rect x="14" y="15" width="7" height="6" rx="1.3"/><path d="M12 9v3m-5.5 3v-3h11v3"/></symbol>
<symbol id="i-atelier" viewBox="0 0 24 24"><path d="M8.5 3.5h7m-5.7 0v6l-5 7.6a2 2 0 0 0 1.7 3.1h11a2 2 0 0 0 1.7-3.1l-5-7.6v-6M7.5 14.5h9"/></symbol>
<symbol id="i-file" viewBox="0 0 24 24"><path d="M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4.5M9 12h6m-6 4h6"/></symbol>
<symbol id="i-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M15.5 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2"/></symbol>
<symbol id="i-direction" viewBox="0 0 24 24"><path d="M12 2.8v4.4m0 9.6v4.4M2.8 12h4.4m9.6 0h4.4"/><path d="m12 6.2 1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z"/></symbol>
</svg>`;

const ext = ' target="_blank" rel="noopener"';
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const href = (id) => `${id}.html`;
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const dot = (f) => (hasOpen(f) ? '<i class="dot" aria-hidden="true"></i><span class="sr"> (décision ouverte)</span>' : "");
const block = (title, inner, attrs = "") => `<section class="block"${attrs}><h2>${esc(title)}</h2>${inner}</section>`;
const actions = (inner) => `<div class="actions">${inner}<span class="status" role="status"></span></div>`;
const hidden = (id, text) => `<textarea id="${id}" class="copy-src" hidden readonly aria-hidden="true">${esc(text)}</textarea>`;
const facts = (pairs) => '<dl class="facts">' + pairs.map(([label, value]) =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("") + "</dl>";

function rows(items) {
  return '<ul class="rows">' + items.map(({ titre, texte, url, external = false, tag = "", mark = "" }) =>
    `<li><a href="${esc(url)}"${external ? ext : ""}><span><strong>${esc(titre)}${mark}</strong>`
    + (tag ? ` <span class="tag" data-f="verifier">${esc(tag)}</span>` : "")
    + (texte ? `<small>${esc(texte)}</small>` : "") + `</span>${icon(external ? "diagonal" : "arrow")}</a></li>`).join("") + "</ul>";
}

function branches(parent, { current = "", openIds = new Set(), counts = false } = {}) {
  const list = kids(parent);
  if (!list.length) return "";
  return "<ul>" + list.map((node) => {
    const link = `<a href="${href(node.id)}"${node.id === current ? ' aria-current="page"' : ""}>${esc(node.titre)}${dot(node)}</a>`;
    const sub = branches(node.id, { current, openIds, counts });
    if (!sub) return `<li>${link}</li>`;
    const total = counts ? `<small class="n" title="Fiches dans cette branche">${countUnder(node.id)}</small>` : "";
    return `<li><details${openIds.has(node.id) ? " open" : ""}><summary>${link}${total}</summary>${sub}</details></li>`;
  }).join("") + "</ul>";
}

function sidebar(current = "") {
  const openIds = new Set(pathTo(current).map((n) => n.id));
  return `<nav class="tree" id="arborescence" aria-label="Arborescence du plan"><h2>Arborescence</h2>`
    + `<div class="branches">${branches("", { current, openIds })}</div>`
    + `<p class="tree-legend"><i class="dot" aria-hidden="true"></i> Décision ouverte dans la fiche</p></nav>`;
}

const NAV = [
  ["carte", "index.html#carte", "Carte"],
  ["decisions", "decisions.html", "Décisions"],
  ["sources", "sources.html", "Sources"],
  ["guide", "guide.html", "Guide"],
];

function layout({ title, description, main, navKey = "", head = "" }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101712">
<meta name="description" content="${esc(description)}">
<title>${esc(title)}</title>
<link rel="preload" href="assets/instrument-serif.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="studio.css">
<link rel="icon" href="assets/studio-icon.png" type="image/png">
<link rel="alternate" type="text/markdown" href="plan.md" title="Plan complet en Markdown">
${head}<script src="tools.js" defer></script>
<script src="search-index.js" defer></script>
<script src="studio.js" defer></script>
</head>
<body>
${SPRITE}
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="top">
<div class="shell top-in">
<a class="brand" href="index.html" aria-label="Studio de contenu, accueil"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>Studio de contenu</span></a>
<nav class="top-nav" aria-label="Navigation principale">${NAV.map(([key, url, label]) =>
    `<a href="${url}"${key === navKey ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
<button class="search-btn" type="button" id="open-search" aria-label="Rechercher dans le plan" aria-keyshortcuts="Control+K Meta+K" hidden>${icon("search")}<span>Rechercher</span><kbd>Ctrl K</kbd></button>
</div>
</header>
<main id="contenu" tabindex="-1">
${main}
</main>
<footer class="shell foot">
<p>${esc(plan.titre)} · phase ${esc(plan.phase)} · généré le ${esc(genereLe)}</p>
<nav aria-label="Ressources">
<a href="plan.md">${icon("file")} Plan complet (Markdown)</a>
<a href="plan.json">Données (JSON)</a>
<a href="${esc(plan.source.url)}"${ext} title="${esc(plan.source.note)}">${esc(plan.source.titre)} ${icon("diagonal")}</a>
</nav>
</footer>
<dialog id="search" aria-labelledby="search-title">
<div class="dialog-head"><h2 id="search-title">Rechercher</h2><button class="icon-btn" id="close-search" type="button" aria-label="Fermer la recherche">${icon("close")}</button></div>
<label class="search-box">${icon("search")}<input type="search" id="search-input" placeholder="Une fiche, un repère, un mot…" aria-label="Rechercher dans le plan" autocomplete="off" maxlength="150"></label>
<p class="search-status" id="search-status" aria-live="polite"></p>
<ul id="search-results" class="rows" aria-label="Résultats"></ul>
</dialog>
</body>
</html>
`;
}

function sheetPage({ title, intro, kicker = "", crumbs = "", body, domain = "", current = "", navKey = "" }) {
  const main = `<div class="shell frame">
${sidebar(current)}
<article class="sheet" data-domain="${domain}">
<header class="sheet-head">
<img src="assets/architecture-du-plan.webp" alt="" width="1536" height="1024">
<nav class="crumbs" aria-label="Fil d’Ariane"><a href="index.html">Accueil</a>${crumbs}<a class="to-tree" href="#arborescence">Arborescence</a></nav>
${kicker}<h1>${esc(title)}</h1>
<p class="intro">${esc(intro)}</p>
</header>
<div class="sheet-body">
${body}
</div>
</article>
</div>`;
  return layout({ title: `${title} · ${plan.titre}`, description: intro, main, navKey });
}

// ---------------------------------------------------------------- fiches

const words = {
  etabli: ["point appuyé sur une source", "points appuyés sur une source"],
  methode: ["règle ou méthode du studio", "règles et méthodes du studio"],
  verifier: ["point à vérifier", "points à vérifier"],
};

function directionBlock(f) {
  const pts = pointsOf(f);
  const tally = { etabli: 0, methode: 0, verifier: 0 };
  for (const { point } of pts) tally[famille(point)] += 1;
  const chips = Object.entries(tally).filter(([, n]) => n).map(([key, n]) =>
    `<span class="tag" data-f="${key}">${n} ${words[key][n > 1 ? 1 : 0]}</span>`).join("");
  const todo = pts.filter(({ point }) => famille(point) === "verifier");
  const more = [
    f.apport ? `<div><dt>Il te reste à apporter</dt><dd>${esc(f.apport)}</dd></div>` : "",
    f.pret ? `<div><dt>Prêt quand</dt><dd>${esc(f.pret)}</dd></div>` : "",
  ].join("");
  return `<section class="direction" aria-labelledby="t-direction">
<h2 id="t-direction">${icon("direction")} Direction</h2>
<p class="direction-text">${esc(f.direction)}</p>
${more ? `<dl>${more}</dl>` : ""}
${chips ? `<p class="bilan">${chips}</p>` : ""}
${todo.length ? `<p class="todo"><strong>À vérifier ici.</strong> ${todo.map(({ point, anchor }) =>
    `<a href="#${anchor}">${esc(point.titre)}</a>`).join(" · ")}</p>` : ""}
</section>`;
}

function pointHtml(point, anchor) {
  const [label, fam, sens] = E[etatDe(point)];
  const refs = (point.references ?? []).map(source);
  return `<div class="point" id="${anchor}" data-f="${fam}"><h3>${esc(point.titre)}</h3> `
    + `<span class="tag" data-f="${fam}" title="${esc(sens)}">${esc(label)}</span><p>${esc(point.texte)}</p>`
    + (refs.length ? `<p class="appuis"><span>Appuis</span>${refs.map((ref) =>
      `<a href="${esc(ref.url)}"${ext}>${esc(ref.titre)}</a>`).join("")}</p>` : "") + "</div>";
}

const gabaritTexte = (g) => g.titre + "\n\n" + g.champs.map(([nom, indication]) => nom + "\n" + indication + "\n…").join("\n\n");

function quizTool() {
  const resultats = T.comparerFormatsQuiz(quizFormats, { choix: 3, caracteres: null, correction: "libre", compter: false });
  return `<section class="block tool" id="comparateur"><h2>Comparer les formats</h2>
<form id="quiz-form" class="tool-form">
<label>Nombre de choix<input type="number" name="choix" min="2" step="1" value="3"></label>
<label>Longueur maximale prévue (caractères)<input type="number" name="caracteres" min="1" step="1" placeholder="Facultatif"></label>
<label>Où apparaît le corrigé<select name="correction">${Object.entries(T.lieuxCorrectionQuiz).map(([id, label]) =>
    `<option value="${id}">${esc(label)}</option>`).join("")}</select></label>
<label class="check"><input type="checkbox" name="compter"> Compter les choix dans le format</label>
</form>
<p class="tool-help">La comparaison utilise les paramètres saisis. Vérifie l’accès dans le compte du format retenu.</p>
<p class="sr" id="quiz-status" role="status"></p>
<div id="quiz-results">${T.rendreFormatsQuiz(resultats)}</div>
<script type="application/json" id="quiz-data">${json(quizFormats)}</script>
</section>`;
}

function lotTool() {
  return `<section class="block tool" id="controle"><h2>Contrôler un dossier</h2>
<p id="lot-help">Insère le gabarit ou colle un dossier JSON. Le contrôle se fait dans cet onglet : rien n’est envoyé.</p>
<form id="lot-form"><label for="lot-draft">Dossier JSON</label>
<textarea id="lot-draft" rows="10" spellcheck="false" autocomplete="off" aria-describedby="lot-help"></textarea>
${actions(`<button type="submit" class="btn primary">Vérifier le dossier</button><button type="button" id="lot-template" class="btn">Insérer le gabarit</button><button type="button" id="lot-copy" class="btn" disabled>${icon("copy")} Copier le dossier</button>`)}
</form>
<section id="lot-result" class="result" tabindex="-1" aria-live="polite" hidden></section>
</section>`;
}

function autonomieTool(title = "Contrôle d’autonomie") {
  const a = plan.autonomie;
  return `<section class="block tool" id="autonomie"><h2>${esc(title)}</h2>
<p>${esc(a.test)}</p>
<form id="autonomie-form" class="autonomie">
${a.criteres.map(([titre, max, aide], index) => `<label><span class="crit"><strong>${esc(titre)}</strong><small>${esc(aide)}</small></span>`
    + `<span class="range"><input type="range" name="c${index}" min="0" max="${max}" step="1" value="0"><output>0 / ${max}</output></span></label>`).join("\n")}
<label class="check"><input type="checkbox" name="sans-echec"> Aucun contrôle bloquant n’est en échec</label>
</form>
<p class="verdict" id="autonomie-verdict" role="status" data-state="todo"><strong>0 / 100</strong> <span>Seuil de préparation : ${a.seuil}. Note chaque critère pour savoir si le Shell peut être transmis.</span></p>
<p class="tool-help">La note est une auto-évaluation : elle aide à repérer ce qui manque au Shell avant de le transmettre.</p>
${actions(`<button type="button" id="autonomie-copy" class="btn">${icon("copy")} Copier le relevé</button>`)}
<script type="application/json" id="autonomie-data">${json(a)}</script>
</section>`;
}

function ficheMd(f, { h = "##", base = "" } = {}) {
  const lines = [`${h} ${f.titre}`, "", `- Chemin : ${trail(f.id)}`];
  if (f.repere) lines.push(`- Repère : ${f.repere}`);
  lines.push(`- Identifiant : ${f.id}`, `- Adresse : ${base}${f.id}.html`);
  if (f.statut) lines.push(`- Statut : ${f.statut}`);
  lines.push("", f.intro, "", `**Direction.** ${f.direction}`);
  if (f.apport) lines.push("", `**Il te reste à apporter.** ${f.apport}`);
  if (f.pret) lines.push("", `**Prêt quand.** ${f.pret}`);
  const section = (title) => lines.push("", `${h}# ${title}`, "");
  if (kids(f.id).length) {
    section(f.titreEnfants || "Sous-sections");
    for (const c of kids(f.id)) lines.push(`- [${c.titre}](${base}${c.id}.html) — ${c.intro}`);
  }
  if (f.champs?.length) {
    section(f.titreChamps || "À renseigner");
    for (const [label, value] of f.champs) lines.push(`- **${label}.** ${value}`);
  }
  if (f.gabarit) {
    section(f.gabarit.titre);
    for (const [label, value] of f.gabarit.champs) lines.push(`- **${label}.** ${value}`);
  }
  if (f.comparateurQuiz) {
    section("Formats comparés");
    for (const format of quizFormats) {
      lines.push(`- **${format.titre}.** ${T.resumeFormatQuiz(format)}. ${format.detail}${format.attente ? " " + format.attente : ""}`);
      for (const ref of format.appuis) lines.push(`  - Appui : ${ref.titre} — ${ref.url}`);
    }
  }
  for (const bloc of f.blocs ?? []) {
    section(bloc.titre);
    for (const point of bloc.points) {
      lines.push(`- **${point.titre}** [${E[etatDe(point)][0]}]. ${point.texte}`);
      for (const ref of (point.references ?? []).map(source)) {
        lines.push(`  - Appui : ${ref.titre} — ${ref.url} (consultée le ${ref.date})`);
      }
    }
  }
  if (f.controleLot) {
    section("Gabarit JSON du dossier");
    lines.push("```json", JSON.stringify(T.gabaritLot, null, 2), "```");
  }
  if (f.controleAutonomie) {
    const grille = plan.autonomie;
    section(`Contrôle d’autonomie (seuil : ${grille.seuil} sur 100)`);
    lines.push(grille.test, "");
    for (const [titre, max, aide] of grille.criteres) lines.push(`- **${titre}** (${max}). ${aide}`);
  }
  if (f.liens?.length) {
    section("Ensuite");
    for (const link of f.liens) lines.push(`- [${link.titre ?? byId.get(link.id).titre}](${base}${link.id}.html) — ${trail(link.id)}`);
  }
  if (f.sources?.length) {
    section("Sources");
    for (const s of f.sources) lines.push(`- ${s.titre} — ${s.url} (${s.date})`);
  }
  return lines.join("\n");
}

function fichePage(f) {
  const trailNodes = pathTo(f.id);
  const index = order.indexOf(f);
  const prev = order[index - 1];
  const next = order[index + 1];
  const parts = [directionBlock(f)];

  const children = kids(f.id);
  if (children.length) {
    parts.push(block(f.titreEnfants || "Sous-sections", rows(children.map((c) => ({
      titre: c.titre, texte: c.intro, url: href(c.id), mark: dot(c),
    })))));
  }
  if (f.champs?.length) parts.push(block(f.titreChamps || "À renseigner", facts(f.champs)));
  if (f.gabarit) {
    parts.push(block(f.gabarit.titre, facts(f.gabarit.champs)
      + actions(`<button type="button" class="btn" data-copy="gabarit-texte" data-done="Gabarit copié.">${icon("copy")} Copier le gabarit</button>`)
      + hidden("gabarit-texte", gabaritTexte(f.gabarit))));
  }
  if (f.comparateurQuiz) parts.push(quizTool());
  const many = (f.blocs ?? []).length > 1;
  (f.blocs ?? []).forEach((bloc, b) => {
    parts.push(`<section class="block"><h2>${many ? `<span class="num">${b + 1}</span>` : ""}${esc(bloc.titre)}</h2>`
      + bloc.points.map((point, p) => pointHtml(point, `b${b + 1}-p${p + 1}`)).join("") + "</section>");
  });
  if (f.controleLot) parts.push(lotTool());
  if (f.controleAutonomie) parts.push(autonomieTool());
  if (f.liens?.length) {
    parts.push(block("Ensuite", rows(f.liens.map((link) => ({
      titre: link.titre ?? byId.get(link.id).titre, texte: trail(link.id), url: href(link.id),
    })))));
  }
  if (f.sources?.length) {
    parts.push(block("Sources", rows(f.sources.map((s) => ({ titre: s.titre, texte: s.date, url: s.url, external: true })))));
  }
  if (f.bibliographie?.length) {
    parts.push(`<section class="block"><details class="fold"><summary>Sources du dossier <small class="n">${f.bibliographie.length}</small></summary>`
      + rows(f.bibliographie.map(source).map((s) => ({
        titre: s.titre, texte: `${s.portee} Consultée le ${s.date}.`, url: s.url, external: true,
      }))) + "</details></section>");
  }

  const consigne = f.consigneIA ?? plan.consigne_defaut;
  const brief = `Fiche du ${plan.titre} · phase ${plan.phase}. Plan complet : %BASE%plan.md\n\nConsigne. ${consigne}\n\n`
    + ficheMd(f, { h: "#", base: "%BASE%" }) + "\n";
  parts.push(`<section class="block handoff"><h2>Transmettre</h2>
<p>Copie la fiche complète avec sa consigne, pour une IA ou pour une autre personne.</p>
${actions(`<button type="button" class="btn primary" data-copy="brief" data-done="Fiche copiée.">${icon("copy")} Copier la fiche</button><a class="btn" href="plan.md">${icon("file")} Plan complet</a>`)}
${hidden("brief", brief)}
<p class="ident">Identifiant de fiche : <code>${f.id}</code></p>
</section>`);

  parts.push(`<nav class="pager" aria-label="Fiche précédente et suivante">`
    + (prev ? `<a href="${href(prev.id)}" rel="prev">${icon("back")}<span><small>Précédente</small><strong>${esc(prev.titre)}</strong></span></a>` : "<span></span>")
    + (next ? `<a class="next" href="${href(next.id)}" rel="next"><span><small>Suivante</small><strong>${esc(next.titre)}</strong></span>${icon("arrow")}</a>` : "<span></span>")
    + "</nav>");

  const crumbs = trailNodes.map((node, i) => icon("chevron") + (i === trailNodes.length - 1
    ? `<span aria-current="page">${esc(node.titre)}</span>`
    : `<a href="${href(node.id)}">${esc(node.titre)}</a>`)).join("");
  const kicker = f.repere || f.statut ? `<p class="kicker">`
    + (f.repere ? `<span class="repere" title="Repère de la fiche">${esc(f.repere)}</span>` : "")
    + (f.statut ? `<span class="statut" data-state="${f.etat === "open" ? "open" : "ok"}">${esc(f.statut)}</span>` : "") + "</p>" : "";
  return sheetPage({
    title: f.titre, intro: f.intro, kicker, crumbs, body: parts.join("\n"),
    domain: trailNodes[0].id, current: f.id, navKey: "",
  });
}

// ------------------------------------------------------------ pages fixes

const lastCrumb = (label) => icon("chevron") + `<span aria-current="page">${esc(label)}</span>`;
const grilleCommune = plan.autonomie;
const guideIntro = "Comment lire une fiche, par où commencer et quand un Shell est prêt à être transmis.";
const decisionsIntro = "Tout ce qui reste à trancher, à vérifier ou à éprouver dans le plan, regroupé par nature.";
const sourcesIntro = "Chaque source documentaire, ce qu’elle permet d’affirmer, sa date de consultation et les fiches qui s’y appuient.";

const lecture = [
  ["Direction", "Ce qu’il faut faire ici, en premier."],
  ["Il te reste à apporter", "Les idées et le travail de création que le plan ne fournit pas."],
  ["Prêt quand", "La condition vérifiable qui clôt la préparation de la fiche."],
  ["Étapes et points", "La méthode. Chaque point porte une étiquette qui dit sur quoi il repose."],
  ["Ensuite", "Les fiches à ouvrir après celle-ci."],
];

const guideTexte = () => [
  `${plan.titre} · phase ${plan.phase}`, "%BASE%guide.html", "Plan complet : %BASE%plan.md", "",
  "Lire une fiche", ...lecture.map(([titre, texte]) => `- ${titre}. ${texte}`), "",
  "Préparation, production, arrêt", ...plan.modes.map(([titre, texte]) => `- ${titre}. ${texte}`), "",
  `Contrôle d’autonomie (seuil ${grilleCommune.seuil} sur 100)`, grilleCommune.test,
  ...grilleCommune.criteres.map(([titre, max, aide]) => `- ${titre} (${max}). ${aide}`), "",
  "Tenir le plan", ...plan.reperes.map(([titre, texte]) => `- ${titre}. ${texte}`),
].join("\n");

function guidePage() {
  const origine = byId.get(grilleCommune.origine);
  const legend = Object.entries(plan.familles).map(([key, [titre, sens]]) =>
    `<div class="legend" data-f="${key}"><h3>${esc(titre)}</h3><p>${esc(sens)}</p><ul>`
    + Object.values(E).filter(([, fam]) => fam === key).map(([label, , texte]) =>
      `<li><span class="tag" data-f="${key}">${esc(label)}</span> ${esc(texte)}</li>`).join("") + "</ul></div>").join("");
  const body = [
    `<section class="direction" aria-labelledby="t-direction"><h2 id="t-direction">${icon("direction")} Direction</h2>
<p class="direction-text">${esc(plan.promesse)}</p>
<dl><div><dt>Le plan fournit</dt><dd>Le périmètre, les formats, les contrôles, les droits, les coûts et la preuve attendue de chaque fiche.</dd></div>
<div><dt>Il te reste à apporter</dt><dd>Les idées originales et le travail de création. Les idées se déposent dans l’<a href="atelier.html">Atelier</a>.</dd></div></dl></section>`,
    block("Lire une fiche", facts(lecture) + `<div class="legends">${legend}</div>`, ' id="lire"'),
    block("Par où commencer", `<ol class="rows numbered">` + plan.parcours.map(([id, role]) =>
      `<li><a href="${href(id)}"><span><strong>${esc(byId.get(id).titre)}</strong><small>${esc(role)}</small></span>${icon("arrow")}</a></li>`).join("") + "</ol>", ' id="commencer"'),
    block("Préparation, production, arrêt", facts(plan.modes), ' id="modes"'),
    autonomieTool("Savoir si un Shell est prêt")
      .replace("</form>", `</form>\n<p class="tool-help">Cette grille vient de la fiche <a href="${href(origine.id)}">${esc(origine.titre)}</a>. Elle vaut pour chaque Shell.</p>`),
    block("Tenir le plan", '<ol class="steps">' + plan.reperes.map(([titre, texte]) =>
      `<li><strong>${esc(titre)}.</strong> ${esc(texte)}</li>`).join("") + "</ol>", ' id="reperes"'),
    block("Glossaire", facts(plan.glossaire), ' id="glossaire"'),
    `<section class="block handoff" id="ia"><h2>Transmettre à une IA</h2>
<p>Une IA peut lire tout le plan en un seul fichier, ou recevoir ces repères dans une conversation.</p>
${actions(`<button type="button" class="btn primary" data-copy="guide-texte" data-done="Repères copiés.">${icon("copy")} Copier les repères</button><a class="btn" href="plan.md">${icon("file")} Plan complet (Markdown)</a><a class="btn" href="plan.json">Données (JSON)</a><a class="btn" href="llms.txt">llms.txt</a>`)}
${hidden("guide-texte", guideTexte())}</section>`,
  ].join("\n");
  return sheetPage({ title: "Guide du plan", intro: guideIntro, crumbs: lastCrumb("Guide"), body, navKey: "guide" });
}

function decisionsPage() {
  const total = groupes.reduce((sum, g) => sum + g.items.length, 0);
  const body = `<section class="direction" aria-labelledby="t-direction"><h2 id="t-direction">${icon("direction")} Direction</h2>
<p class="direction-text">Commencer par les décisions du studio : elles débloquent le premier essai. Les autres points se vérifient au moment où la fiche concernée est utilisée.</p>
<p class="bilan">${groupes.filter((g) => g.items.length).map((g) => `<a class="tag" data-f="verifier" href="#${g.id}">${g.items.length} ${esc(g.court)}</a>`).join("")}</p></section>`
    + groupes.filter((g) => g.items.length).map((g) => `<section class="block" id="${g.id}"><h2>${esc(g.titre)}</h2><p class="lead">${esc(g.texte)}</p>`
      + rows(g.items.map((item) => ({ titre: item.titre, tag: item.tag, texte: `${trail(item.fiche.id)} — ${item.texte}`, url: item.url }))) + "</section>").join("\n")
    + (closes.length ? `<section class="block" id="closes"><h2>Décisions closes</h2><p class="lead">Tranchées. Elles ne demandent plus de recherche.</p>`
      + rows(closes.map((f) => ({ titre: f.titre, texte: `${f.statut} — ${trail(f.id)}`, url: href(f.id) }))) + "</section>" : "");
  return sheetPage({
    title: "Décisions ouvertes", intro: `${decisionsIntro} ${total} points ouverts.`,
    crumbs: lastCrumb("Décisions"), body, navKey: "decisions",
  });
}

const sourceGroups = [["YT", "YouTube"], ["TT", "TikTok"], ["IG", "Instagram"], ["FB", "Facebook"], ["X", "X"]];
const sourceGroup = (id) => (sourceGroups.find(([prefix]) => id.startsWith(prefix + "-")) ?? [null, "Recherche, droits et outils"])[1];

function sourcesPage() {
  const grouped = new Map();
  for (const [id, s] of Object.entries(plan.sources_documentaires)) {
    const key = sourceGroup(id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push([id, s]);
  }
  const body = `<section class="direction" aria-labelledby="t-direction"><h2 id="t-direction">${icon("direction")} Direction</h2>
<p class="direction-text">Avant de s’appuyer sur une règle de plateforme, rouvrir sa source et comparer avec la date de consultation. Si la règle a changé, corriger la fiche qui la cite.</p></section>`
    + [...grouped].map(([titre, list]) => `<section class="block"><h2>${esc(titre)}</h2><ul class="sources">`
      + list.map(([id, s]) => `<li id="src-${esc(id)}"><h3><a href="${esc(s.url)}"${ext}>${esc(s.titre)} ${icon("diagonal")}</a></h3>`
        + `<p>${esc(s.portee)}</p><p class="meta">Consultée le ${esc(s.date)}`
        + ([...usages.get(id)].length ? ` · Citée dans ${[...usages.get(id)].map((f) => `<a href="${href(f.id)}">${esc(f.titre)}</a>`).join(", ")}` : "")
        + "</p></li>").join("") + "</ul></section>").join("\n")
    + block(plan.source.titre, `<p class="lead">Le classeur garde les formules, les comparatifs et les essais cités dans les fiches. ${esc(plan.source.note)}</p>`
      + rows([{ titre: plan.source.titre, texte: plan.source.note, url: plan.source.url, external: true }]));
  return sheetPage({
    title: "Sources", intro: sourcesIntro, crumbs: lastCrumb("Sources"), body, navKey: "sources",
  });
}

function homePage() {
  const phaseFiche = kids().find((f) => f.titre === plan.phase);
  const redirect = `<script>(function(){var h="";try{h=decodeURIComponent(location.hash.slice(1))}catch(e){}`
    + `var m=${json({ domaines: "index.html#carte", ...Object.fromEntries(Object.entries(plan.alias).map(([ancien, cible]) => [ancien, cible + ".html"])) })};if(m.hasOwnProperty(h)){location.replace(m[h]);return}`
    + `if(${json(fiches.map((f) => f.id))}.indexOf(h)>-1)location.replace(h+".html")})();</script>\n`;
  const studio = groupes[0];
  const main = `<div class="shell home">
<section class="hero" aria-labelledby="home-title">
<img src="assets/architecture-du-plan.webp" width="1536" height="1024" alt="" fetchpriority="high">
<div class="hero-in">
${phaseFiche ? `<a class="phase" href="${href(phaseFiche.id)}"><i aria-hidden="true"></i> Phase · ${esc(plan.phase)}</a>` : `<span class="phase"><i aria-hidden="true"></i> Phase · ${esc(plan.phase)}</span>`}
<h1 id="home-title">Plan du <em>studio</em></h1>
<p class="accroche">${esc(plan.accroche)}</p>
<p class="promesse">${esc(plan.promesse)}</p>
<p class="cta"><a class="btn primary" href="#parcours">Commencer ici ${icon("arrow")}</a><a class="btn ghost" href="#carte">Voir la carte</a></p>
</div>
</section>

<section class="band" id="parcours" aria-labelledby="t-parcours" tabindex="-1">
<header class="band-head"><h2 id="t-parcours">Par où commencer</h2><p>Six marches, dans l’ordre. Chacune ouvre la fiche qui dit quoi faire.</p></header>
<ol class="stairs">${plan.parcours.map(([id, role], i) =>
    `<li style="--i:${i};--j:${i % 3}"><a href="${href(id)}"><strong>${esc(byId.get(id).titre)}</strong><span>${esc(role)}</span></a></li>`).join("")}</ol>
</section>

<section class="band" id="carte" aria-labelledby="t-carte" tabindex="-1">
<header class="band-head"><h2 id="t-carte">Carte du studio</h2><p>${fiches.length} fiches en ${kids().length} domaines. Chaque fiche s’ouvre sur sa direction.</p>
<button class="btn ghost" type="button" id="expand-map" hidden>Tout déplier</button></header>
<ul class="map">${kids().map((rootNode) => `<li class="slab" data-d="${rootNode.id}">`
    + `<h3><a href="${href(rootNode.id)}">${icon(rootNode.id)}<span>${esc(rootNode.titre)}</span></a></h3>`
    + `<p class="count">${countUnder(rootNode.id)} fiches</p>`
    + `<p>${esc(rootNode.intro)}</p><div class="branches">${branches(rootNode.id, { counts: true })}</div></li>`).join("\n")}</ul>
<p class="tree-legend"><i class="dot" aria-hidden="true"></i> Décision ouverte dans la fiche</p>
</section>

<section class="band" id="decisions" aria-labelledby="t-decisions" tabindex="-1">
<header class="band-head"><h2 id="t-decisions">Décisions ouvertes</h2><p>Ce qui reste à trancher avant le premier essai.</p></header>
<div class="board">
<ul class="tally">${groupes.filter((g) => g.items.length).map((g) =>
    `<li><a href="decisions.html#${g.id}"><b>${g.items.length}</b><span>${esc(g.court)}</span></a></li>`).join("")}</ul>
<div>${rows(studio.items.map((item) => ({ titre: item.titre, tag: item.tag, texte: trail(item.fiche.id), url: item.url })))}
<p class="more"><a class="btn ghost" href="decisions.html">Toutes les décisions ${icon("arrow")}</a></p></div>
</div>
</section>
</div>`;
  return layout({ title: plan.titre, description: `${plan.accroche} ${plan.promesse}`, main, navKey: "carte", head: redirect });
}

// ------------------------------------------------------ fichiers pour IA

function planMd() {
  const lines = [
    `# ${plan.titre}`, "",
    `Phase : ${plan.phase}. Généré le ${genereLe}.`, "",
    `${plan.accroche} ${plan.promesse}`, "",
    "## Lire ce plan", "",
    ...lecture.map(([titre, texte]) => `- **${titre}.** ${texte}`), "",
    "Étiquettes des points :", "",
    ...Object.values(E).map(([label, fam, texte]) => `- **${label}** (${plan.familles[fam][0].toLowerCase()}). ${texte}`), "",
    "## Préparation, production, arrêt", "",
    ...plan.modes.map(([titre, texte]) => `- **${titre}.** ${texte}`), "",
    `## Contrôle d’autonomie (seuil : ${grilleCommune.seuil} sur 100)`, "", grilleCommune.test, "",
    ...grilleCommune.criteres.map(([titre, max, aide]) => `- **${titre}** (${max}). ${aide}`), "",
    "## Par où commencer", "",
    ...plan.parcours.map(([id, role], i) => `${i + 1}. [${byId.get(id).titre}](${id}.html) — ${role}`), "",
    "## Tenir le plan", "",
    ...plan.reperes.map(([titre, texte]) => `- **${titre}.** ${texte}`), "",
    "## Décisions ouvertes", "",
  ];
  for (const g of groupes.filter((group) => group.items.length)) {
    lines.push(`### ${g.titre}`, "", g.texte, "");
    for (const item of g.items) lines.push(`- **${item.titre}** [${item.tag}] — ${trail(item.fiche.id)} (${item.url})`);
    lines.push("");
  }
  if (closes.length) {
    lines.push("### Décisions closes", "");
    for (const f of closes) lines.push(`- **${f.titre}** [${f.statut}] — ${trail(f.id)} (${f.id}.html)`);
    lines.push("");
  }
  lines.push("## Arborescence", "");
  for (const f of order) lines.push(`${"  ".repeat(pathTo(f.id).length - 1)}- [${f.titre}](${f.id}.html)${f.repere ? ` · ${f.repere}` : ""}`);
  lines.push("", "---", "");
  for (const f of order) lines.push(ficheMd(f), "", "---", "");
  lines.push("## Glossaire", "", ...plan.glossaire.map(([terme, texte]) => `- **${terme}.** ${texte}`), "");
  lines.push("## Sources documentaires", "");
  for (const s of Object.values(plan.sources_documentaires)) lines.push(`- ${s.titre} — ${s.url} · ${s.portee} Consultée le ${s.date}.`);
  lines.push(`- ${plan.source.titre} — ${plan.source.url} · ${plan.source.note}`, "");
  return lines.join("\n");
}

function llmsTxt() {
  return [
    `# ${plan.titre}`, "",
    `> ${plan.accroche} ${plan.promesse}`, "",
    `Phase : ${plan.phase}. Généré le ${genereLe}. Chaque fiche est une page HTML lisible sans JavaScript.`, "",
    "## Fichiers", "",
    "- [Plan complet](plan.md): toutes les fiches en un seul fichier Markdown",
    "- [Données](plan.json): la source structurée du plan",
    "- [Guide](guide.html): lecture d’une fiche, modes de travail, contrôle d’autonomie, glossaire",
    "- [Décisions ouvertes](decisions.html): ce qui reste à trancher, à vérifier ou à éprouver",
    "- [Sources](sources.html): sources documentaires et dates de consultation", "",
    "## Fiches", "",
    ...order.map((f) => `- [${trail(f.id)}](${f.id}.html): ${f.direction}`), "",
  ].join("\n");
}

function searchIndex() {
  const entries = order.map((f) => ({
    i: f.id, u: href(f.id), t: f.titre, p: trail(f.id, -1), d: pathTo(f.id)[0].id, a: f.parent ? 0 : 1,
    n: norm(`${f.titre} ${f.repere ?? ""}`),
    x: norm([
      f.intro, f.direction, f.apport, f.pret, f.statut, ...(f.champs ?? []).flat(),
      ...(f.gabarit ? [f.gabarit.titre, ...f.gabarit.champs.flat()] : []),
      ...(f.comparateurQuiz ? plan.quiz_formats.map((format) => format.titre) : []),
      ...(f.blocs ?? []).flatMap((bloc) => [bloc.titre, ...bloc.points.flatMap((point) => [point.titre, point.texte])]),
    ].filter(Boolean).join(" ")),
  }));
  const fixed = [
    ["guide", "Guide du plan", guideIntro + " " + plan.glossaire.flat().join(" ") + " " + plan.modes.flat().join(" ")],
    ["decisions", "Décisions ouvertes", decisionsIntro],
    ["sources", "Sources", sourcesIntro + " " + Object.values(plan.sources_documentaires).map((s) => s.titre).join(" ")],
  ].map(([id, titre, texte]) => ({ i: id, u: href(id), t: titre, p: "", d: "", a: 1, n: norm(titre), x: norm(texte) }));
  return "window.PLAN_INDEX=" + json([...entries, ...fixed]) + ";\n";
}

// ---------------------------------------------------------------- sortie

await rm(out(), { recursive: true, force: true });
await mkdir(out(), { recursive: true });
await cp(src("assets"), out("assets"), { recursive: true });
for (const file of ["studio.css", "studio.js", "tools.js"]) await cp(src(file), out(file));
await cp(src("plan.json"), out("plan.json"));

const pages = new Map([
  ["index.html", homePage()],
  ["guide.html", guidePage()],
  ["decisions.html", decisionsPage()],
  ["sources.html", sourcesPage()],
  ...order.map((f) => [href(f.id), fichePage(f)]),
  ["plan.md", planMd()],
  ["llms.txt", llmsTxt()],
  ["search-index.js", searchIndex()],
]);
for (const [file, content] of pages) await writeFile(out(file), content, "utf8");

console.log(`Site généré : ${fiches.length} fiches, ${pages.size + 1} fichiers dans dist/`);
