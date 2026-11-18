import assert from "node:assert/strict";
import { test } from "node:test";
import { annoncerPublication } from "../annoncer-publication.mjs";

const webhook = "https://discord.com/api/webhooks/123/faux-jeton";
const site = "https://exemple.github.io/plan-studio/";

test("sans webhook configuré, aucune requête ne part", async () => {
  assert.equal(await annoncerPublication({ site, envoyer: () => assert.fail() }), false);
});

test("l’annonce envoie le lien publié, sans mention Discord", async () => {
  const envoyee = await annoncerPublication({
    webhook,
    site,
    envoyer: async (url, options) => {
      assert.equal(url, `${webhook}?wait=true`);
      assert.equal(options.method, "POST");
      const message = JSON.parse(options.body);
      assert.match(message.content, /Production Evolve/);
      assert.ok(message.content.endsWith(site));
      assert.deepEqual(message.allowed_mentions, { parse: [] });
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(envoyee, true);
});

test("un refus de Discord est signalé sans exposer le webhook", async () => {
  await assert.rejects(annoncerPublication({
    webhook, site, envoyer: async () => new Response(webhook, { status: 404 }),
  }), { message: "Discord a refusé l’annonce (HTTP 404)." });
});
