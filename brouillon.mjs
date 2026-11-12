// Compare le brouillon publié à la dernière version déjà intégrée dans ce site. Ne modifie jamais src/plan.json.
// Usage : node brouillon.mjs            liste ce qui a changé et écrit le détail dans brouillon-ecarts.json
//         node brouillon.mjs --integre  marque le brouillon actuel comme intégré, une fois ses nouveautés reportées
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const snapshot = path.join(root, "src", "brouillon.json");
const report = path.join(root, "brouillon-ecarts.json");
const origin = process.argv.find((arg) => /^https?:/.test(arg)) ?? "https://plan-studio-contenu.zoard-subscription.chatgpt.site/plan.json";

const response = await fetch(origin);
if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}) : ${origin}`);
const text = await response.text();
const draft = JSON.parse(text);
if (!Array.isArray(draft.fiches) || !draft.fiches.length) throw new Error("Le brouillon reçu ne contient pas de fiches.");

if (process.argv.includes("--integre")) {
  await writeFile(snapshot, text, "utf8");
  await rm(report, { force: true });
  console.log(`Brouillon marqué comme intégré : ${draft.fiches.length} fiches.`);
  process.exit(0);
}

const known = JSON.parse(await readFile(snapshot, "utf8"));
const before = new Map(known.fiches.map((f) => [f.id, f]));
const after = new Map(draft.fiches.map((f) => [f.id, f]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ecarts = {
  nouvelles: draft.fiches.filter((f) => !before.has(f.id)),
  retirees: [...before.keys()].filter((id) => !after.has(id)),
  modifiees: draft.fiches.filter((f) => before.has(f.id) && !same(f, before.get(f.id))).map((f) => ({ avant: before.get(f.id), apres: f })),
  reste: Object.fromEntries(Object.keys({ ...known, ...draft }).filter((key) => key !== "fiches" && !same(known[key], draft[key]))
    .map((key) => [key, { avant: known[key] ?? null, apres: draft[key] ?? null }])),
};
const total = ecarts.nouvelles.length + ecarts.retirees.length + ecarts.modifiees.length + Object.keys(ecarts.reste).length;
const list = (ids) => (ids.length ? ids.join(", ") : "aucune");

console.log(`Brouillon : ${draft.fiches.length} fiches, depuis ${origin}`);
console.log(`Fiches nouvelles : ${list(ecarts.nouvelles.map((f) => f.id))}`);
console.log(`Fiches retirées : ${list(ecarts.retirees)}`);
console.log(`Fiches modifiées : ${list(ecarts.modifiees.map((e) => e.apres.id))}`);
console.log(`Autres rubriques modifiées : ${list(Object.keys(ecarts.reste))}`);
if (total) {
  await writeFile(report, JSON.stringify(ecarts, null, 2) + "\n", "utf8");
  console.log("\nDétail écrit dans brouillon-ecarts.json. Reporte ce qui est utile dans src/plan.json, puis lance : node brouillon.mjs --integre");
} else {
  await rm(report, { force: true });
  console.log("\nRien de nouveau depuis la dernière intégration.");
}
