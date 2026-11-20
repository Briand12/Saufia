const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const HOST = "0.0.0.0";

const options = {
    key: fs.readFileSync("192.168.1.38+2-key.pem"),
    cert: fs.readFileSync("192.168.1.38+2.pem")
};

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac"
};


/* =========================================================
   LIRE LE CORPS D'UNE REQUÊTE JSON
========================================================= */

function lireCorpsJSON(req) {
    return new Promise((resolve, reject) => {
        let corps = "";

        req.on("data", morceau => {
            corps += morceau;

            if (corps.length > 100000) {
                reject(new Error("Requête trop volumineuse."));
                req.destroy();
            }
        });

        req.on("end", () => {
            if (!corps.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(corps));
            } catch (erreur) {
                reject(new Error("JSON invalide."));
            }
        });

        req.on("error", erreur => {
            reject(erreur);
        });
    });
}


/* =========================================================
   API : PRISE DE RENDEZ-VOUS
========================================================= */

async function gererRendezVous(req, res) {
    try {
        const donnees = await lireCorpsJSON(req);

        console.log("");
        console.log("======================================");
        console.log(" 📅 NOUVELLE DEMANDE DE RENDEZ-VOUS");
        console.log("======================================");
        console.log("Nom :", donnees.nom || "(non renseigné)");
        console.log("E-mail :", donnees.email || "(non renseigné)");
        console.log("Date :", donnees.date || "(non renseignée)");
        console.log("Heure :", donnees.heure || "(non renseignée)");
        console.log("Motif :", donnees.motif || "(non renseigné)");
        console.log("======================================");
        console.log("");

        if (!donnees.nom) {
            res.writeHead(400, {
                "Content-Type": "application/json; charset=utf-8"
            });
            res.end(JSON.stringify({
                ok: false,
                erreur: "Le nom est obligatoire."
            }));
            return;
        }

        if (!donnees.email) {
            res.writeHead(400, {
                "Content-Type": "application/json; charset=utf-8"
            });
            res.end(JSON.stringify({
                ok: false,
                erreur: "L'adresse e-mail est obligatoire."
            }));
            return;
        }

        if (!donnees.date) {
            res.writeHead(400, {
                "Content-Type": "application/json; charset=utf-8"
            });
            res.end(JSON.stringify({
                ok: false,
                erreur: "La date du rendez-vous est obligatoire."
            }));
            return;
        }

        if (!donnees.heure) {
            res.writeHead(400, {
                "Content-Type": "application/json; charset=utf-8"
            });
            res.end(JSON.stringify({
                ok: false,
                erreur: "L'heure du rendez-vous est obligatoire."
            }));
            return;
        }

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });

        res.end(JSON.stringify({
            ok: true,
            message: "La demande de rendez-vous a bien été reçue.",
            rendezVous: {
                nom: donnees.nom,
                email: donnees.email,
                date: donnees.date,
                heure: donnees.heure,
                motif: donnees.motif || ""
            }
        }));

    } catch (erreur) {
        console.error("❌ Erreur rendez-vous :", erreur);

        res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8"
        });

        res.end(JSON.stringify({
            ok: false,
            erreur: erreur.message ||
                "Impossible de traiter la demande."
        }));
    }
}


/* =========================================================
   CHEMIN SÉCURISÉ
========================================================= */

function cheminSecurise(urlPath) {
    let chemin = decodeURIComponent(
        urlPath.split("?")[0]
    );

    if (chemin === "/" || chemin === "") {
        chemin = "/index.html";
    }

    const fichier = path.join(__dirname, chemin);
    const racine = path.resolve(__dirname);
    const fichierAbsolu = path.resolve(fichier);

    if (
        fichierAbsolu !== racine &&
        !fichierAbsolu.startsWith(racine + path.sep)
    ) {
        return null;
    }

    return fichierAbsolu;
}


/* =========================================================
   SERVIR UN FICHIER
========================================================= */

function servirFichier(req, res, filePath) {
    fs.stat(filePath, (error, stats) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("Fichier introuvable.");
            return;
        }

        if (!stats.isFile()) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            res.end("Ce n'est pas un fichier.");
            return;
        }

        const extension = path.extname(filePath).toLowerCase();
        const contentType =
            MIME_TYPES[extension] ||
            "application/octet-stream";

        const estVideo =
            extension === ".mp4" ||
            extension === ".webm";

        const estAudio =
            extension === ".mp3" ||
            extension === ".wav" ||
            extension === ".ogg" ||
            extension === ".m4a" ||
            extension === ".aac";

        /*
         * VIDÉOS ET AUDIO
         * Prise en charge des requêtes Range.
         */

        if (estVideo || estAudio) {
            const taille = stats.size;
            const range = req.headers.range;

            if (range) {
                const morceaux = range
                    .replace(/bytes=/, "")
                    .split("-");

                const debut = parseInt(morceaux[0], 10);
                let fin;

                if (morceaux[1]) {
                    fin = parseInt(morceaux[1], 10);
                } else {
                    fin = taille - 1;
                }

                if (
                    isNaN(debut) ||
                    debut < 0 ||
                    debut >= taille
                ) {
                    res.writeHead(416, {
                        "Content-Range": `bytes */${taille}`
                    });
                    res.end();
                    return;
                }

                if (isNaN(fin) || fin >= taille) {
                    fin = taille - 1;
                }

                const longueur = fin - debut + 1;

                res.writeHead(206, {
                    "Content-Type": contentType,
                    "Content-Length": longueur,
                    "Content-Range":
                        `bytes ${debut}-${fin}/${taille}`,
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                });

                const flux = fs.createReadStream(filePath, {
                    start: debut,
                    end: fin
                });

                flux.on("error", () => {
                    if (!res.headersSent) {
                        res.writeHead(500);
                    }
                    res.end();
                });

                flux.pipe(res);
                return;
            }

            res.writeHead(200, {
                "Content-Type": contentType,
                "Content-Length": stats.size,
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });

            const flux = fs.createReadStream(filePath);

            flux.on("error", () => {
                if (!res.headersSent) {
                    res.writeHead(500);
                }
                res.end();
            });

            flux.pipe(res);
            return;
        }

        /*
         * AUTRES FICHIERS :
         * HTML, JavaScript, CSS, JSON, images, etc.
         */

        fs.readFile(filePath, (readError, content) => {
            if (readError) {
                res.writeHead(500, {
                    "Content-Type": "text/plain; charset=utf-8"
                });
                res.end("Erreur lors de la lecture du fichier.");
                return;
            }

            res.writeHead(200, {
                "Content-Type": contentType,
                "Cache-Control": "no-cache"
            });

            res.end(content);
        });
    });
}


/* =========================================================
   BIBLIOTHÈQUE MUSICALE — STOCKAGE LOCAL
========================================================= */

const DOSSIER_DATA = path.join(__dirname, "data");
const DOSSIER_UPLOADS = path.join(
    __dirname,
    "bibliotheque_uploads"
);
const FICHIER_BIBLIOTHEQUE = path.join(
    DOSSIER_DATA,
    "bibliotheque-musicale.json"
);


/* Crée les dossiers nécessaires. */

function preparerDossiersMusique() {
    fs.mkdirSync(DOSSIER_DATA, { recursive: true });

    fs.mkdirSync(
        path.join(DOSSIER_UPLOADS, "images"),
        { recursive: true }
    );

    fs.mkdirSync(
        path.join(DOSSIER_UPLOADS, "audio"),
        { recursive: true }
    );
}


/* Envoie une réponse JSON. */

function repondreJSON(res, code, donnees) {
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(donnees));
}


/* Lit la bibliothèque musicale sauvegardée. */

function lireBibliothequeMusicale() {
    preparerDossiersMusique();

    try {
        const contenu = fs.readFileSync(
            FICHIER_BIBLIOTHEQUE,
            "utf8"
        );

        const donnees = JSON.parse(contenu);

        return {
            styles: Array.isArray(donnees.styles)
                ? donnees.styles
                : [],

            morceauxParStyle:
                donnees.morceauxParStyle &&
                typeof donnees.morceauxParStyle === "object"
                    ? donnees.morceauxParStyle
                    : {}
        };

    } catch (erreur) {
        if (
            erreur.code !== "ENOENT" &&
            !(erreur instanceof SyntaxError)
        ) {
            throw erreur;
        }

        return {
            styles: [],
            morceauxParStyle: {}
        };
    }
}


/* Sauvegarde la bibliothèque musicale. */

function enregistrerBibliothequeMusicale(donnees) {
    preparerDossiersMusique();

    if (
        !donnees ||
        typeof donnees !== "object" ||
        Array.isArray(donnees)
    ) {
        throw new Error(
            "Les données de la bibliothèque sont invalides."
        );
    }

    const propre = {
        styles: Array.isArray(donnees.styles)
            ? donnees.styles
            : [],

        morceauxParStyle:
            donnees.morceauxParStyle &&
            typeof donnees.morceauxParStyle === "object"
                ? donnees.morceauxParStyle
                : {}
    };

    fs.writeFileSync(
        FICHIER_BIBLIOTHEQUE,
        JSON.stringify(propre, null, 2),
        "utf8"
    );
}


/* Nettoie les noms des fichiers reçus. */

function nomFichierSecurise(nom) {
    const base = path.basename(String(nom || "fichier"));

    const sansAccents = base
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    return sansAccents
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^\.+/, "") || "fichier";
}


/* =========================================================
   RÉCEPTION DES FICHIERS ENVOYÉS PAR LE NAVIGATEUR
========================================================= */

function lireMultipart(req) {
    return new Promise((resolve, reject) => {
        const type = req.headers["content-type"] || "";

        const match = type.match(
            /boundary=(?:"([^"]+)"|([^;]+))/i
        );

        if (!match) {
            return reject(
                new Error(
                    "Formulaire de fichier invalide (boundary absent)."
                )
            );
        }

        const boundary = Buffer.from(
            "--" + (match[1] || match[2])
        );

        const morceaux = [];
        let taille = 0;
        let rejete = false;

        const limite = 150 * 1024 * 1024;

        req.on("data", morceau => {
            taille += morceau.length;

            if (taille > limite) {
                rejete = true;

                reject(
                    new Error(
                        "Fichier trop volumineux (limite de 150 Mo)."
                    )
                );

                req.destroy();
                return;
            }

            morceaux.push(morceau);
        });

        req.on("error", erreur => {
            if (!rejete) {
                reject(erreur);
            }
        });

        req.on("end", () => {
            if (rejete) {
                return;
            }

            try {
                const corps = Buffer.concat(morceaux);
                const champs = {};

                let fichier = null;
                let position = 0;

                while (
                    (position = corps.indexOf(
                        boundary,
                        position
                    )) !== -1
                ) {
                    position += boundary.length;

                    if (
                        corps.slice(
                            position,
                            position + 2
                        ).toString() === "--"
                    ) {
                        break;
                    }

                    if (
                        corps.slice(
                            position,
                            position + 2
                        ).toString() === "\r\n"
                    ) {
                        position += 2;
                    }

                    const finEntetes = corps.indexOf(
                        Buffer.from("\r\n\r\n"),
                        position
                    );

                    if (finEntetes === -1) {
                        break;
                    }

                    const entetes = corps
                        .slice(position, finEntetes)
                        .toString("utf8");

                    const debutDonnees = finEntetes + 4;

                    const finDonnees = corps.indexOf(
                        Buffer.concat([
                            Buffer.from("\r\n"),
                            boundary
                        ]),
                        debutDonnees
                    );

                    if (finDonnees === -1) {
                        break;
                    }

                    const disp = entetes.match(
                        /content-disposition:\s*form-data;([^\r\n]+)/i
                    );

                    if (disp) {
                        const nomMatch = disp[1].match(
                            /name="([^"]*)"/i
                        );

                        const fichierMatch = disp[1].match(
                            /filename="([^"]*)"/i
                        );

                        const nomChamp = nomMatch
                            ? nomMatch[1]
                            : "";

                        const contenu = corps.slice(
                            debutDonnees,
                            finDonnees
                        );

                        if (
                            fichierMatch &&
                            nomChamp === "fichier"
                        ) {
                            const typeMatch = entetes.match(
                                /content-type:\s*([^\r\n]+)/i
                            );

                            fichier = {
                                nom: fichierMatch[1],
                                type: typeMatch
                                    ? typeMatch[1].trim()
                                    : "application/octet-stream",
                                contenu
                            };

                        } else if (nomChamp) {
                            champs[nomChamp] =
                                contenu.toString("utf8");
                        }
                    }

                    position = finDonnees + 2;
                }

                if (!fichier) {
                    return reject(
                        new Error(
                            "Aucun fichier n'a été reçu."
                        )
                    );
                }

                resolve({
                    fichier,
                    categorie: champs.categorie || ""
                });

            } catch (erreur) {
                reject(erreur);
            }
        });
    });
}


/* =========================================================
   ENREGISTREMENT DES MP3 ET DES IMAGES
========================================================= */

async function traiterUploadMusique(req, res) {
    try {
        preparerDossiersMusique();

        const resultat = await lireMultipart(req);
        const fichier = resultat.fichier;
        const categorie = resultat.categorie;

        const extension = path.extname(
            fichier.nom
        ).toLowerCase();

        let typeDossier;

        if (
            categorie === "audio" ||
            extension === ".mp3" ||
            fichier.type === "audio/mpeg"
        ) {
            typeDossier = "audio";

        } else if (
            categorie === "image" ||
            [".png", ".jpg", ".jpeg", ".webp", ".gif"]
                .includes(extension)
        ) {
            typeDossier = "images";

        } else {
            return repondreJSON(res, 400, {
                ok: false,
                erreur:
                    "Format de fichier non accepté. Choisis un MP3 ou une image."
            });
        }

        if (
            typeDossier === "audio" &&
            extension !== ".mp3"
        ) {
            return repondreJSON(res, 400, {
                ok: false,
                erreur:
                    "Le fichier audio doit être au format MP3."
            });
        }

        if (
            typeDossier === "images" &&
            ![".png", ".jpg", ".jpeg", ".webp", ".gif"]
                .includes(extension)
        ) {
            return repondreJSON(res, 400, {
                ok: false,
                erreur: "Format d'image non accepté."
            });
        }

        const nomFinal =
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 8) +
            "-" +
            nomFichierSecurise(fichier.nom);

        const chemin = path.join(
            DOSSIER_UPLOADS,
            typeDossier,
            nomFinal
        );

        fs.writeFileSync(chemin, fichier.contenu);

        const cheminPublic =
            "/bibliotheque_uploads/" +
            (typeDossier === "images" ? "images/" : "audio/") +
            nomFinal;

        return repondreJSON(res, 200, {
            ok: true,
            chemin: cheminPublic
        });

    } catch (erreur) {
        return repondreJSON(res, 400, {
            ok: false,
            erreur:
                erreur.message ||
                "Échec de l'envoi du fichier."
        });
    }
}


/* =========================================================
   SERVEUR HTTPS
========================================================= */

const server = https.createServer(
    options,
    async (req, res) => {

        const urlSansQuery = (req.url || "")
            .split("?")[0];

        /*
         * LECTURE DE LA BIBLIOTHÈQUE MUSICALE
         */

        if (
            urlSansQuery === "/api/bibliotheque-musicale" &&
            req.method === "GET"
        ) {
            try {
                return repondreJSON(
                    res,
                    200,
                    lireBibliothequeMusicale()
                );

            } catch (erreur) {
                return repondreJSON(res, 500, {
                    ok: false,
                    erreur:
                        "Lecture de la bibliothèque impossible."
                });
            }
        }

        /*
         * SAUVEGARDE DE LA BIBLIOTHÈQUE MUSICALE
         */

        if (
            urlSansQuery === "/api/bibliotheque-musicale" &&
            req.method === "POST"
        ) {
            try {
                const donnees = await lireCorpsJSON(req);

                enregistrerBibliothequeMusicale(donnees);

                return repondreJSON(res, 200, {
                    ok: true
                });

            } catch (erreur) {
                return repondreJSON(res, 400, {
                    ok: false,
                    erreur:
                        erreur.message ||
                        "Sauvegarde impossible."
                });
            }
        }

        /*
         * ENVOI D'UNE IMAGE OU D'UN MP3
         */

        if (
            urlSansQuery ===
                "/api/bibliotheque-musicale/upload" &&
            req.method === "POST"
        ) {
            await traiterUploadMusique(req, res);
            return;
        }

        /*
         * API RENDEZ-VOUS
         */

        if (
            req.url === "/api/rendez-vous" &&
            req.method === "POST"
        ) {
            await gererRendezVous(req, res);
            return;
        }

        /*
         * OPTIONS / CORS POUR LES RENDEZ-VOUS
         */

        if (
            req.url === "/api/rendez-vous" &&
            req.method === "OPTIONS"
        ) {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            });

            res.end();
            return;
        }

        /*
         * SERVIR LES FICHIERS NORMAUX
         */

        const filePath = cheminSecurise(req.url);

        if (!filePath) {
            res.writeHead(403, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Accès interdit.");
            return;
        }

        servirFichier(req, res, filePath);
    }
);


/* =========================================================
   DÉMARRAGE DU SERVEUR
========================================================= */

server.listen(PORT, HOST, () => {
    console.log("");
    console.log("======================================");
    console.log(" Serveur Sophia démarré");
    console.log("======================================");
    console.log("");

    console.log(`https://localhost:${PORT}`);
    console.log(`https://192.168.1.38:${PORT}`);

    console.log("");
    console.log("Le serveur écoute sur le réseau local.");
    console.log("");
    console.log("📅 API rendez-vous :");
    console.log(
        `POST https://localhost:${PORT}/api/rendez-vous`
    );
    console.log("");
});