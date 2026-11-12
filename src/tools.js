(function (root) {
  "use strict";

  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => escapes[char]);
  const norm = (text) => String(text ?? "").toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");

  const lieuxCorrectionQuiz = {
    libre: "Au choix",
    interaction: "Dans l’interaction",
    video: "Dans la vidéo",
    suite: "Dans une publication liée",
  };
  // Valeurs admises dans les formats du plan.
  const revelationsFormat = ["interaction", "video", "suite", "sans"];
  const reponsesFormat = ["resultat_natif", "agregat", "commentaires"];

  const etatsFormatsQuiz = {
    compatible: "Compatible",
    verifier: "À vérifier",
    ecart: "Écart avec les paramètres",
  };

  function comparerFormatsQuiz(formats, { choix, caracteres, correction, compter }) {
    if (!Number.isSafeInteger(choix) || choix < 2
      || (caracteres !== null && (!Number.isSafeInteger(caracteres) || caracteres < 1))
      || !Object.hasOwn(lieuxCorrectionQuiz, correction)) return null;

    return formats.map((format) => {
      const ecarts = [];
      const verifications = [];
      if (format.maxChoix !== null && choix > format.maxChoix) {
        ecarts.push(format.maxChoix === 2 ? "Deux choix requis." : format.maxChoix + " choix maximum.");
      }
      if (format.maxCaracteres !== null && caracteres !== null && caracteres > format.maxCaracteres) {
        ecarts.push(format.maxCaracteres + " caractères maximum par choix.");
      }
      const sans = format.revelation === "sans";
      if (correction !== "libre" && correction !== format.revelation && !(sans && correction === "suite")) {
        ecarts.push(sans ? "Pas de corrigé natif dans ce format." : "Corrigé prévu " + lieuxCorrectionQuiz[format.revelation].toLowerCase() + ".");
      }
      if (compter && format.reponses === "commentaires") {
        ecarts.push("Le comptage des choix demande un dispositif distinct.");
      }
      if (format.attente) verifications.push(format.attente);

      const etat = ecarts.length ? "ecart" : verifications.length ? "verifier" : "compatible";
      return { format, etat, motifs: ecarts.length ? ecarts : verifications };
    });
  }

  function resumeFormatQuiz(format) {
    return [
      format.maxChoix === 2 ? "2 choix" : format.maxChoix ? "Jusqu’à " + format.maxChoix + " choix" : "",
      format.maxCaracteres ? format.maxCaracteres + " caractères par choix" : "",
      format.revelation === "sans" ? "Sans corrigé natif" : lieuxCorrectionQuiz[format.revelation],
    ].filter(Boolean).join(" · ");
  }

  function rendreFormatsQuiz(resultats) {
    if (!resultats) return "<p>Indique au moins deux choix et, si tu la renseignes, une longueur entière positive.</p>";
    const ordre = Object.keys(etatsFormatsQuiz).flatMap((etat) => resultats.filter((item) => item.etat === etat));
    return '<ul class="formats">' + ordre.map(({ format, etat, motifs }) =>
      '<li class="format" data-state="' + etat + '"><h3>' + esc(format.titre) + "</h3>"
      + '<p class="format-state">' + etatsFormatsQuiz[etat] + "</p>"
      + '<p class="format-spec">' + esc(resumeFormatQuiz(format)) + "</p>"
      + "<p>" + esc(format.detail) + "</p>"
      + (motifs.length ? "<ul>" + motifs.map((motif) => "<li>" + esc(motif) + "</li>").join("") + "</ul>" : "")
      + ((format.appuis ?? []).length ? '<p class="appuis">' + format.appuis.map((ref) => '<a href="' + esc(ref.url)
        + '" target="_blank" rel="noopener">' + esc(ref.titre) + "</a>").join("") + "</p>" : "")
      + "</li>").join("") + "</ul>";
  }

  const gabaritLot = {
    version_gabarit: 1,
    lot: "",
    fiche: "",
    revision_fiche: "",
    reseau: "",
    format: "",
    langue: "",
    public: "",
    resultat_attendu: "",
    sources: [{ id: "", origine: "", version: "", usage: "a_verifier", preuve_usage: "" }],
    controles: [{ id: "", attendu: "", preuve_attendue: "", etat: "a_relever", observation: "" }],
  };

  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const hasText = (value) => typeof value === "string" && value.trim().length > 0;

  function verifierDossierLot(dossier, ficheExiste) {
    const erreurs = [];
    const ecarts = [];
    const suivis = [];
    if (!isRecord(dossier)) {
      erreurs.push("Le dossier doit être un objet JSON.");
      return { erreurs, ecarts, suivis };
    }

    function verifierTexte(item, keys, emplacement = "") {
      for (const key of keys) {
        if (!hasText(item[key])) erreurs.push(emplacement + "Renseigne « " + key + " ».");
      }
    }

    function verifierLignes(lignes, nom, verifier) {
      if (!Array.isArray(lignes)) {
        erreurs.push("« " + nom + " » doit être une liste.");
        return;
      }
      const ids = new Set();
      lignes.forEach((item, index) => {
        const emplacement = nom + " " + (index + 1) + " · ";
        if (!isRecord(item)) {
          erreurs.push(emplacement + "Utilise un objet JSON.");
          return;
        }
        if (hasText(item.id)) {
          const id = item.id.trim();
          if (ids.has(id)) erreurs.push(emplacement + "Identifiant déjà utilisé.");
          ids.add(id);
        }
        verifier(item, emplacement);
      });
    }

    if (dossier.version_gabarit !== gabaritLot.version_gabarit) {
      erreurs.push("Utilise la version " + gabaritLot.version_gabarit + " du gabarit.");
    }
    verifierTexte(dossier, ["lot", "fiche", "revision_fiche", "reseau", "format", "langue", "public", "resultat_attendu"]);
    if (hasText(dossier.fiche) && !ficheExiste(dossier.fiche.trim())) {
      erreurs.push("« fiche » doit correspondre à l’identifiant d’une fiche sous Chaînes.");
    }

    verifierLignes(dossier.sources, "Source", (item, emplacement) => {
      verifierTexte(item, ["id", "origine", "version"], emplacement);
      if (item.usage === "documente") {
        verifierTexte(item, ["preuve_usage"], emplacement);
      } else if (item.usage === "a_verifier") {
        suivis.push(emplacement + "Vérifier la preuve d’usage pour cette destination.");
      } else {
        erreurs.push(emplacement + "Indique « documente » ou « a_verifier » dans « usage ».");
      }
    });

    if (Array.isArray(dossier.controles) && dossier.controles.length === 0) {
      erreurs.push("Ajoute au moins un contrôle avec son résultat attendu et sa preuve.");
    }
    verifierLignes(dossier.controles, "Contrôle", (item, emplacement) => {
      verifierTexte(item, ["id", "attendu", "preuve_attendue"], emplacement);
      if (item.etat === "a_relever") {
        suivis.push(emplacement + "Relever l’observation prévue.");
        return;
      }
      if (item.etat === "conforme" || item.etat === "en_ecart") {
        verifierTexte(item, ["observation"], emplacement);
        if (item.etat === "en_ecart") ecarts.push(emplacement + "Reprendre le contrôle signalé en écart.");
        return;
      }
      erreurs.push(emplacement + "Indique « a_relever », « conforme » ou « en_ecart » dans « etat ».");
    });

    return { erreurs, ecarts, suivis };
  }

  function noterAutonomie(criteres, notes, seuil, sansEchec = true) {
    const lignes = criteres.map(([titre, max], index) => {
      const note = Number(notes[index]);
      return { titre, max, note: Number.isFinite(note) ? Math.min(Math.max(Math.round(note), 0), max) : 0 };
    });
    const total = lignes.reduce((sum, ligne) => sum + ligne.note, 0);
    return { lignes, total, atteint: total >= seuil, pret: total >= seuil && sansEchec, incomplets: lignes.filter((ligne) => ligne.note < ligne.max) };
  }

  root.StudioTools = {
    esc, norm, lieuxCorrectionQuiz, revelationsFormat, reponsesFormat, comparerFormatsQuiz, resumeFormatQuiz, rendreFormatsQuiz,
    gabaritLot, verifierDossierLot, noterAutonomie,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
