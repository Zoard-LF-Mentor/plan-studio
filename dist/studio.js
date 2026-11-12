(function () {
  "use strict";

  const T = window.StudioTools;
  const index = window.PLAN_INDEX || [];
  const byId = (id) => document.getElementById(id);
  const base = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  const data = (id) => JSON.parse(byId(id).textContent);

  // ---------------------------------------------------------------- copie

  async function copyText(value, status, done, anchor) {
    document.querySelector(".copy-fallback")?.remove();
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = done;
    } catch {
      const field = document.createElement("textarea");
      field.className = "copy-fallback";
      field.readOnly = true;
      field.setAttribute("aria-label", "Texte à copier");
      field.value = value;
      anchor.after(field);
      field.focus();
      field.select();
      status.textContent = "Texte sélectionné. Utilise Copier.";
    }
  }

  const statusOf = (button) => button.closest(".actions").querySelector(".status");

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value = byId(button.dataset.copy).value.split("%BASE%").join(base);
    void copyText(value, statusOf(button), button.dataset.done || "Copié.", button.closest(".actions"));
  });

  // ------------------------------------------------------------ recherche

  const dialog = byId("search");
  const input = byId("search-input");
  const results = byId("search-results");
  const searchStatus = byId("search-status");
  const searchButton = byId("open-search");
  const arrow = '<svg class="icon" aria-hidden="true"><use href="#i-arrow"></use></svg>';

  function renderSearch() {
    const query = T.norm(input.value).trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = terms.length
      ? index.map((entry) => ({
        entry,
        score: terms.every((term) => entry.n.includes(term) || entry.x.includes(term))
          ? terms.reduce((sum, term) => sum + (entry.n.includes(term) ? 4 : 1), 0) + (entry.n.startsWith(query) ? 3 : 0)
          : 0,
      })).filter((match) => match.score).sort((a, b) => b.score - a.score).map((match) => match.entry)
      : index.filter((entry) => entry.a);
    searchStatus.textContent = terms.length
      ? (matches.length ? matches.length + (matches.length === 1 ? " résultat" : " résultats") : "Aucun résultat")
      : "Accès rapides";
    results.innerHTML = matches.slice(0, 12).map((entry) =>
      '<li><a href="' + T.esc(entry.u) + '"><span><strong>' + T.esc(entry.t) + "</strong>"
      + (entry.p ? "<small>" + T.esc(entry.p) + "</small>" : "") + "</span>" + arrow + "</a></li>").join("");
  }

  function openSearch() {
    if (!dialog.open) dialog.showModal();
    input.value = "";
    renderSearch();
    input.focus();
  }

  if (index.length && typeof dialog.showModal === "function") {
    searchButton.hidden = false;
    searchButton.addEventListener("click", openSearch);
    byId("close-search").addEventListener("click", () => dialog.close());
    input.addEventListener("input", renderSearch);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      const options = [...results.querySelectorAll("a")];
      if (!options.length) return;
      const at = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown" && (at >= 0 || document.activeElement === input)) {
        event.preventDefault();
        options[Math.min(at + 1, options.length - 1)].focus();
      } else if (event.key === "ArrowUp" && at >= 0) {
        event.preventDefault();
        (options[at - 1] ?? input).focus();
      } else if (event.key === "Enter" && document.activeElement === input && input.value.trim()) {
        event.preventDefault();
        options[0].click();
      }
    });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    });
  }

  // ---------------------------------------------------------------- carte

  const mapButton = byId("expand-map");
  if (mapButton) {
    const folds = [...document.querySelectorAll("#carte details")];
    const refresh = () => {
      mapButton.textContent = folds.every((fold) => fold.open) ? "Tout replier" : "Tout déplier";
    };
    mapButton.hidden = false;
    mapButton.addEventListener("click", () => {
      const open = !folds.every((fold) => fold.open);
      for (const fold of folds) fold.open = open;
      refresh();
    });
    for (const fold of folds) fold.addEventListener("toggle", refresh);
  }

  // ----------------------------------------------------- comparateur quiz

  const quizForm = byId("quiz-form");
  if (quizForm) {
    const formats = data("quiz-data");
    const update = () => {
      const fields = new FormData(quizForm);
      const resultats = T.comparerFormatsQuiz(formats, {
        choix: Number(fields.get("choix")),
        caracteres: fields.get("caracteres") === "" ? null : Number(fields.get("caracteres")),
        correction: fields.get("correction"),
        compter: fields.has("compter"),
      });
      byId("quiz-results").innerHTML = T.rendreFormatsQuiz(resultats);
      byId("quiz-status").textContent = resultats
        ? resultats.filter((item) => item.etat === "compatible").length + " compatibles, "
          + resultats.filter((item) => item.etat === "verifier").length + " à vérifier."
        : "Paramètres à corriger.";
    };
    quizForm.addEventListener("input", update);
    quizForm.addEventListener("submit", (event) => event.preventDefault());
  }

  // ------------------------------------------------------- dossier de lot

  const lotForm = byId("lot-form");
  if (lotForm) {
    const draft = byId("lot-draft");
    const result = byId("lot-result");
    const status = lotForm.querySelector(".status");
    const copyButton = byId("lot-copy");
    const ficheExiste = (id) => id !== "chaines" && index.some((entry) => entry.i === id && entry.d === "chaines");

    const reset = () => {
      copyButton.disabled = !draft.value.trim();
      result.hidden = true;
      status.textContent = "";
      draft.removeAttribute("aria-invalid");
    };
    const show = ({ erreurs, ecarts, suivis }) => {
      let title = "Observations renseignées";
      if (erreurs.length) title = "Dossier à compléter";
      else if (ecarts.length) title = "Contrôles à reprendre";
      else if (suivis.length) title = "Dossier structuré · pièces à relever";
      const details = [...erreurs, ...ecarts, ...suivis];
      result.dataset.state = erreurs.length || ecarts.length ? "attention" : "ok";
      result.innerHTML = "<h3>" + title + "</h3>"
        + (details.length ? "<ul>" + details.map((issue) => "<li>" + T.esc(issue) + "</li>").join("") + "</ul>" : "")
        + "<p>Le contrôle vérifie la structure et les déclarations du dossier. Les pièces et le résultat se vérifient sur le lot.</p>";
      result.hidden = false;
      result.focus();
    };

    draft.addEventListener("input", reset);
    lotForm.addEventListener("submit", (event) => {
      event.preventDefault();
      let dossier;
      try {
        dossier = JSON.parse(draft.value);
      } catch {
        draft.setAttribute("aria-invalid", "true");
        show({ erreurs: ["Colle un objet JSON valide ou insère le gabarit."], ecarts: [], suivis: [] });
        return;
      }
      show(T.verifierDossierLot(dossier, ficheExiste));
    });
    byId("lot-template").addEventListener("click", () => {
      if (draft.value.trim()) {
        status.textContent = "Le champ contient déjà un dossier.";
        return;
      }
      draft.value = JSON.stringify(T.gabaritLot, null, 2);
      reset();
      draft.focus();
    });
    copyButton.addEventListener("click", () => void copyText(draft.value, status, "Dossier copié.", copyButton.closest(".actions")));
  }

  // ------------------------------------------------- contrôle d’autonomie

  const autonomieForm = byId("autonomie-form");
  if (autonomieForm) {
    const { criteres, seuil } = data("autonomie-data");
    const verdict = byId("autonomie-verdict");
    const sliders = [...autonomieForm.querySelectorAll("input[type=range]")];
    const sansEchec = autonomieForm.querySelector("input[name=sans-echec]");
    const read = () => T.noterAutonomie(criteres, sliders.map((slider) => slider.value), seuil, sansEchec.checked);
    const sentence = ({ total, atteint, pret, incomplets }) => {
      if (pret) return "Seuil atteint. Le Shell peut être transmis à la production.";
      if (atteint) return "Seuil atteint, mais l’absence d’échec sur un contrôle bloquant n’est pas confirmée. Corriger ou vérifier avant de transmettre.";
      if (!total) return "Seuil de préparation : " + seuil + ". Note chaque critère pour savoir si le Shell peut être transmis.";
      return "Sous le seuil de " + seuil + ". À compléter d’abord : " + incomplets.slice().sort((a, b) =>
        (b.max - b.note) - (a.max - a.note))[0].titre.toLowerCase() + ".";
    };
    const update = () => {
      const releve = read();
      sliders.forEach((slider, i) => {
        slider.nextElementSibling.textContent = releve.lignes[i].note + " / " + releve.lignes[i].max;
      });
      verdict.dataset.state = releve.pret ? "ok" : "todo";
      verdict.innerHTML = "<strong>" + releve.total + " / 100</strong> <span>" + T.esc(sentence(releve)) + "</span>";
    };
    autonomieForm.addEventListener("input", update);
    autonomieForm.addEventListener("submit", (event) => event.preventDefault());
    byId("autonomie-copy").addEventListener("click", (event) => {
      const releve = read();
      const title = document.querySelector(".sheet-head h1")?.textContent ?? "";
      const text = ["Contrôle d’autonomie · " + title, location.href.replace(/#.*$/, ""), "",
        ...releve.lignes.map((ligne) => "- " + ligne.titre + " : " + ligne.note + " / " + ligne.max),
        "- Aucun contrôle bloquant en échec : " + (sansEchec.checked ? "oui" : "non confirmé"),
        "", "Total : " + releve.total + " / 100 (seuil " + seuil + "). " + sentence(releve)].join("\n");
      void copyText(text, statusOf(event.currentTarget), "Relevé copié.", event.currentTarget.closest(".actions"));
    });
    update();
  }
})();
