import { pathToFileURL } from "node:url";

export async function annoncerPublication({ webhook, site, envoyer = fetch }) {
  if (!webhook) return false;

  if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook)) {
    throw new Error("Adresse de webhook Discord invalide.");
  }
  if (!site || !URL.canParse(site) || new URL(site).protocol !== "https:") {
    throw new Error("Adresse du site publié manquante ou invalide.");
  }

  let reponse;
  try {
    reponse = await envoyer(`${webhook}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `📣 Le plan de **Production Evolve** a été mis à jour.\n${site}`,
        allowed_mentions: { parse: [] },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Discord est injoignable ou n’a pas répondu à temps.");
  }
  if (!reponse.ok) throw new Error(`Discord a refusé l’annonce (HTTP ${reponse.status}).`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const envoyee = await annoncerPublication({
      webhook: process.env.DISCORD_PUBLICATION_WEBHOOK,
      site: process.env.SITE_PUBLIE,
    });
    console.log(envoyee ? "Publication annoncée sur Discord." : "Annonce ignorée : webhook Discord non configuré.");
  } catch (error) {
    console.error(`::warning::${error.message}`);
    process.exitCode = 1;
  }
}
