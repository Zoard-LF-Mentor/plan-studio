// Cas à blanc des outils du plan.  Usage : node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../src/tools.js");
const T = globalThis.StudioTools;
const plan = JSON.parse(await readFile(new URL("../src/plan.json", import.meta.url), "utf8"));
const formats = plan.quiz_formats;

const comparer = (choix, { caracteres = null, correction = "libre", compter = false } = {}) =>
  T.comparerFormatsQuiz(formats, { choix, caracteres, correction, compter });
const ids = (resultats, etat) => resultats.filter((r) => r.etat === etat).map((r) => r.format.id).sort();
const motifs = (resultats, id) => resultats.find((r) => r.format.id === id).motifs;
const TOUS = formats.map((f) => f.id).sort();

// --------------------------------------------------- comparateur de formats

test("formats · trois choix : les formats à deux choix sont écartés", () => {
  assert.deepEqual(ids(comparer(3), "ecart"), ["ig-sondage", "yt-short-quiz"]);
  assert.deepEqual(ids(comparer(3), "compatible"), ["capsule-video", "x-sondage", "yt-post-quiz", "yt-post-sondage"]);
});
test("formats · deux choix : tous les formats conviennent", () => {
  assert.deepEqual(ids(comparer(2), "compatible"), TOUS);
});
test("formats · quatre choix : même résultat que trois", () => {
  assert.deepEqual(ids(comparer(4), "compatible"), ids(comparer(3), "compatible"));
});
test("formats · cinq choix : seule la capsule vidéo convient", () => {
  assert.deepEqual(ids(comparer(5), "compatible"), ["capsule-video"]);
  assert.deepEqual(motifs(comparer(5), "yt-post-quiz"), ["4 choix maximum."]);
  assert.deepEqual(motifs(comparer(5), "yt-short-quiz"), ["Deux choix requis."]);
});
test("formats · 25 caractères : aucune limite dépassée", () => {
  assert.deepEqual(ids(comparer(2, { caracteres: 25 }), "compatible"), TOUS);
});
test("formats · 26 caractères : X Poll est écarté", () => {
  assert.deepEqual(ids(comparer(2, { caracteres: 26 }), "ecart"), ["x-sondage"]);
});
test("formats · 65 puis 66 caractères : limite du Community Poll", () => {
  assert.ok(!ids(comparer(2, { caracteres: 65 }), "ecart").includes("yt-post-sondage"));
  assert.ok(ids(comparer(2, { caracteres: 66 }), "ecart").includes("yt-post-sondage"));
});
test("formats · 80 puis 81 caractères : limite du Community Quiz", () => {
  assert.ok(!ids(comparer(2, { caracteres: 80 }), "ecart").includes("yt-post-quiz"));
  assert.deepEqual(motifs(comparer(2, { caracteres: 81 }), "yt-post-quiz"), ["80 caractères maximum par choix."]);
});
test("formats · longueur ignorée quand le format n’a pas de limite", () => {
  assert.deepEqual(ids(comparer(2, { caracteres: 500 }), "compatible"), ["capsule-video", "ig-sondage", "yt-short-quiz"]);
});
test("formats · corrigé dans l’interaction : les quiz natifs seulement", () => {
  const r = comparer(2, { correction: "interaction" });
  assert.deepEqual(ids(r, "compatible"), ["yt-post-quiz", "yt-short-quiz"]);
  assert.deepEqual(motifs(r, "x-sondage"), ["Pas de corrigé natif dans ce format."]);
  assert.deepEqual(motifs(r, "capsule-video"), ["Corrigé prévu dans la vidéo."]);
});
test("formats · corrigé dans la vidéo : la capsule seulement", () => {
  assert.deepEqual(ids(comparer(2, { correction: "video" }), "compatible"), ["capsule-video"]);
});
test("formats · corrigé dans une publication liée : les sondages seulement", () => {
  const r = comparer(2, { correction: "suite" });
  assert.deepEqual(ids(r, "compatible"), ["ig-sondage", "x-sondage", "yt-post-sondage"]);
  assert.deepEqual(motifs(r, "yt-post-quiz"), ["Corrigé prévu dans l’interaction."]);
});
test("formats · comptage des choix : les commentaires ne sont pas des votes", () => {
  const r = comparer(2, { compter: true });
  assert.deepEqual(ids(r, "ecart"), ["capsule-video"]);
  assert.deepEqual(motifs(r, "capsule-video"), ["Le comptage des choix demande un dispositif distinct."]);
});
test("formats · comptage et corrigé dans l’interaction se cumulent", () => {
  const r = comparer(2, { correction: "interaction", compter: true });
  assert.deepEqual(ids(r, "compatible"), ["yt-post-quiz", "yt-short-quiz"]);
  assert.equal(motifs(r, "capsule-video").length, 2);
});
test("formats · un seul choix est refusé", () => assert.equal(comparer(1), null));
test("formats · un nombre de choix non entier est refusé", () => assert.equal(comparer(2.5), null));
test("formats · un nombre de choix absent est refusé", () => assert.equal(comparer(NaN), null));
test("formats · une longueur nulle est refusée", () => assert.equal(comparer(2, { caracteres: 0 }), null));
test("formats · une longueur non entière est refusée", () => assert.equal(comparer(2, { caracteres: 1.5 }), null));
test("formats · un lieu de corrigé inconnu est refusé", () => assert.equal(comparer(2, { correction: "ailleurs" }), null));
test("formats · chaque résultat porte un état, et un motif s’il n’est pas compatible", () => {
  for (const r of comparer(5, { caracteres: 90, correction: "video", compter: true })) {
    assert.ok(["compatible", "verifier", "ecart"].includes(r.etat));
    assert.equal(r.motifs.length > 0, r.etat !== "compatible");
  }
});

// ----------------------------------------------------------- dossier de lot

const dossier = () => ({
  version_gabarit: 1, lot: "lot-01", fiche: "quiz-jeux", revision_fiche: "r1", reseau: "YouTube", format: "Short",
  langue: "fr", public: "joueurs francophones", resultat_attendu: "sortie verticale conforme",
  sources: [{ id: "s1", origine: "banque interne", version: "v1", usage: "documente", preuve_usage: "licence-01" }],
  controles: [{ id: "c1", attendu: "9:16", preuve_attendue: "relevé ffprobe", etat: "conforme", observation: "720 × 1280" }],
});
const sousChaines = (id) => id === "quiz-jeux";
const verifier = (d) => T.verifierDossierLot(d, sousChaines);
const avec = (changes) => ({ ...dossier(), ...changes });

test("lot · dossier complet : aucune remarque", () => {
  assert.deepEqual(verifier(dossier()), { erreurs: [], ecarts: [], suivis: [] });
});
test("lot · ce qui n’est pas un objet est refusé", () => {
  for (const valeur of [null, [], "texte", 3]) assert.deepEqual(verifier(valeur).erreurs, ["Le dossier doit être un objet JSON."]);
});
test("lot · autre version du gabarit", () => {
  assert.deepEqual(verifier(avec({ version_gabarit: 2 })).erreurs, ["Utilise la version 1 du gabarit."]);
});
test("lot · champ de texte vide", () => {
  assert.deepEqual(verifier(avec({ lot: "  " })).erreurs, ["Renseigne « lot »."]);
});
test("lot · fiche inconnue ou hors des Chaînes", () => {
  assert.deepEqual(verifier(avec({ fiche: "couts" })).erreurs, ["« fiche » doit correspondre à l’identifiant d’une fiche sous Chaînes."]);
});
test("lot · les sources doivent être une liste", () => {
  assert.deepEqual(verifier(avec({ sources: "s1" })).erreurs, ["« Source » doit être une liste."]);
});
test("lot · liste de sources vide acceptée", () => {
  assert.deepEqual(verifier(avec({ sources: [] })).erreurs, []);
});
test("lot · autorisation déclarée sans pièce", () => {
  const d = dossier();
  d.sources[0].preuve_usage = "";
  assert.deepEqual(verifier(d).erreurs, ["Source 1 · Renseigne « preuve_usage »."]);
});
test("lot · usage à vérifier : un suivi, pas une erreur", () => {
  const d = dossier();
  Object.assign(d.sources[0], { usage: "a_verifier", preuve_usage: "" });
  assert.deepEqual(verifier(d), { erreurs: [], ecarts: [], suivis: ["Source 1 · Vérifier la preuve d’usage pour cette destination."] });
});
test("lot · usage inconnu", () => {
  const d = dossier();
  d.sources[0].usage = "libre";
  assert.deepEqual(verifier(d).erreurs, ["Source 1 · Indique « documente » ou « a_verifier » dans « usage »."]);
});
test("lot · identifiants de source en double", () => {
  const d = dossier();
  d.sources.push({ ...d.sources[0] });
  assert.deepEqual(verifier(d).erreurs, ["Source 2 · Identifiant déjà utilisé."]);
});
test("lot · une ligne qui n’est pas un objet", () => {
  assert.deepEqual(verifier(avec({ controles: ["c1"] })).erreurs, ["Contrôle 1 · Utilise un objet JSON."]);
});
test("lot · aucun contrôle", () => {
  assert.deepEqual(verifier(avec({ controles: [] })).erreurs, ["Ajoute au moins un contrôle avec son résultat attendu et sa preuve."]);
});
test("lot · conformité sans observation", () => {
  const d = dossier();
  d.controles[0].observation = "";
  assert.deepEqual(verifier(d).erreurs, ["Contrôle 1 · Renseigne « observation »."]);
});
test("lot · contrôle en écart", () => {
  const d = dossier();
  d.controles[0].etat = "en_ecart";
  assert.deepEqual(verifier(d), { erreurs: [], ecarts: ["Contrôle 1 · Reprendre le contrôle signalé en écart."], suivis: [] });
});
test("lot · contrôle à relever : un suivi", () => {
  const d = dossier();
  Object.assign(d.controles[0], { etat: "a_relever", observation: "" });
  assert.deepEqual(verifier(d), { erreurs: [], ecarts: [], suivis: ["Contrôle 1 · Relever l’observation prévue."] });
});
test("lot · état de contrôle inconnu", () => {
  const d = dossier();
  d.controles[0].etat = "ok";
  assert.deepEqual(verifier(d).erreurs, ["Contrôle 1 · Indique « a_relever », « conforme » ou « en_ecart » dans « etat »."]);
});
test("lot · le gabarit vide signale ce qui manque, sans planter", () => {
  const r = verifier(structuredClone(T.gabaritLot));
  assert.equal(r.erreurs.length, 14);
  assert.equal(r.suivis.length, 2);
});

// ---------------------------------------------------- contrôle d’autonomie

const { criteres, seuil } = plan.autonomie;
const maxima = criteres.map(([, max]) => max);

test("autonomie · tous les critères au maximum font 100", () => {
  assert.equal(T.noterAutonomie(criteres, maxima, seuil).total, 100);
});
test("autonomie · sous le seuil : pas prêt", () => {
  const r = T.noterAutonomie(criteres, maxima.map((max) => max - 3), seuil);
  assert.equal(r.total, 82);
  assert.equal(r.pret, false);
});
test("autonomie · seuil atteint sans confirmation des contrôles bloquants : pas prêt", () => {
  const r = T.noterAutonomie(criteres, maxima, seuil, false);
  assert.equal(r.atteint, true);
  assert.equal(r.pret, false);
});
test("autonomie · les notes hors bornes sont ramenées dans les bornes", () => {
  assert.equal(T.noterAutonomie(criteres, maxima.map((max) => max + 50), seuil).total, 100);
  assert.equal(T.noterAutonomie(criteres, maxima.map(() => -5), seuil).total, 0);
});
