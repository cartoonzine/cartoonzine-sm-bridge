import fs from 'fs/promises';

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const GITHUB_RAW_BASE =
    "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";

const TMDB_KEY = process.env.TMDB_KEY;

if (!TMDB_KEY) {
    throw new Error(
        "❌ TMDB_KEY não configurada. Adicione TMDB_KEY em Settings > Secrets and variables > Actions."
    );
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


// ============================================================
// LIMPEZA DE TÍTULOS PARA TMDB
// ============================================================

function limparTituloParaBusca(titulo) {

    if (!titulo) {
        return "";
    }

    const regex =
        /\s*\(\d{4}\)|\s*\[.*?\]|\b(4K|1080p|UHD|FHD|HD|SD|LEG|DUB)\b/gi;

    return titulo
        .replace(regex, "")
        .trim();
}


// ============================================================
// CACHE TMDB
// ============================================================

const tmdbCache = new Map();


// ============================================================
// CONSULTA TMDB
// ============================================================

async function fetchTMDB(titulo, isSerie = false) {

    const tituloLimpo = limparTituloParaBusca(titulo);

    if (!tituloLimpo) {

        return {
            desc: "Sinopse em breve...",
            thumb: "",
            bannerThumb: "",
            year: ""
        };
    }

    const cacheKey =
        (isSerie ? "s" : "f") +
        "|" +
        tituloLimpo.toLowerCase();

    if (tmdbCache.has(cacheKey)) {
        return tmdbCache.get(cacheKey);
    }

    const tipo = isSerie ? "tv" : "movie";

    const query = encodeURIComponent(tituloLimpo);

    const url =
        TMDB_BASE +
        "/search/" +
        tipo +
        "?query=" +
        query +
        "&api_key=" +
        TMDB_KEY +
        "&language=pt-BR";

    let resData = {
        desc: "Sinopse em breve...",
        thumb: "",
        bannerThumb: "",
        year: ""
    };

    try {

        const res = await fetch(url);

        if (res.ok) {

            const data = await res.json();

            if (
                data.results &&
                data.results.length > 0
            ) {

                const item = data.results[0];

                resData = {

                    desc:
                        item.overview ||
                        "Sinopse não disponível.",

                    thumb:
                        item.poster_path
                            ? TMDB_IMG + item.poster_path
                            : "",

                    bannerThumb:
                        item.backdrop_path
                            ? TMDB_IMG + item.backdrop_path
                            : "",

                    year:
                        (
                            item.release_date ||
                            item.first_air_date ||
                            ""
                        ).substring(0, 4)
                };
            }
        }

    } catch (e) {

        console.warn(
            `⚠️ TMDB falhou para "${titulo}":`,
            e.message
        );
    }

    tmdbCache.set(cacheKey, resData);

    return resData;
}


// ============================================================
// CARREGAR GÊNEROS
// ============================================================

async function carregarGeneros() {

    const mapa = new Map();

    try {

        const res = await fetch(
            GITHUB_RAW_BASE + "vod/generos.txt"
        );

        if (!res.ok) {
            return mapa;
        }

        const texto = await res.text();

        texto
            .split(/\r?\n/)
            .forEach(linha => {

                if (linha.startsWith("#")) {
                    return;
                }

                const campos = linha.split("\t");

                if (campos.length >= 3) {

                    mapa.set(
                        campos[0] + "|" + campos[1],
                        campos[2]
                            .split(",")[0]
                            .trim()
                    );
                }
            });

    } catch (e) {

        console.warn(
            "⚠️ Não foi possível carregar generos.txt:",
            e.message
        );
    }

    return mapa;
}


// ============================================================
// CLASSIFICAÇÃO DE CANAIS
// ============================================================

function classificarCanal(nome) {

    if (!nome) {
        return "Variedades";
    }

    const n = nome.toLowerCase();

    if (
        /(sexy hot|playboy|adulto|venus|hustler|private|sex)/
        .test(n)
    ) {
        return "Adulto";
    }

    if (/(pluto)/.test(n)) {
        return "Pluto TV";
    }

    if (
        /(espn|sportv|premiere|combate|band sports|cazé|caze|nsports|xsports)/
        .test(n)
    ) {
        return "Esportes";
    }

    if (
        /(news|globonews|cnn|record news|jovem pan|terra viva)/
        .test(n)
    ) {
        return "Notícias";
    }

    if (
        /(cartoon|nick|discovery kids|gloob|infantil|kids|boomerang)/
        .test(n)
    ) {
        return "Infantil";
    }

    if (
        /(discovery|history|animal planet|natgeo|national geographic|investigação)/
        .test(n)
    ) {
        return "Documentários";
    }

    if (
        /(hbo|telecine|megapix|paramount|tnt|space|universal|amc|cinemax|star)/
        .test(n)
    ) {
        return "Filmes e Séries";
    }

    if (
        /(globo|sbt|record|band|rede tv|redetv|cultura|gazeta)/
        .test(n)
    ) {
        return "TV Aberta";
    }

    return "Variedades";
}


// ============================================================
// NORMALIZAR NOME DO CANAL
// ============================================================

function normalizarNomeCanal(nome) {

    return String(nome || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}


// ============================================================
// PROCESSAR CANAIS
// ============================================================
//
// IMPORTANTE:
//
// O scraper antigo fazia:
//
// canal
//   fonte 1 -> salva
//   fonte 2 -> ignora
//   fonte 3 -> ignora
//
// Agora:
//
// canal
//   fonte 1 -> salva
//   fonte 2 -> salva
//   fonte 3 -> salva
//
// Isso preserva os fallbacks do catálogo.
// ============================================================

async function processarCanais() {

    console.log(
        "📺 Baixando catálogo de canais do SaimoPlayer..."
    );

    try {

        const urlCatalogo =
            GITHUB_RAW_BASE + "catalogo.txt";

        const res = await fetch(urlCatalogo);

        if (!res.ok) {

            throw new Error(
                `Falha ao baixar catalogo.txt: HTTP ${res.status}`
            );
        }

        const texto = await res.text();

        const linhas = texto.split(/\r?\n/);

        const canais = [];

        let canalAtual = null;


        // =====================================================
        // LER CATALOGO.TXT
        // =====================================================

        for (let linha of linhas) {

            linha = linha.trim();

            if (!linha) {
                continue;
            }

            if (linha.startsWith("#")) {
                continue;
            }

            const separador =
                linha.indexOf(":");

            if (separador === -1) {
                continue;
            }

            const chave =
                linha
                    .substring(0, separador)
                    .trim()
                    .toLowerCase();

            const valor =
                linha
                    .substring(separador + 1)
                    .trim();

            if (!valor) {
                continue;
            }


            // =================================================
            // NOVO CANAL
            // =================================================

            if (chave === "canal") {

                canalAtual = {

                    nome: valor,

                    logo: "",

                    categoria:
                        classificarCanal(valor),

                    fontes: []
                };

                canais.push(canalAtual);

                continue;
            }


            if (!canalAtual) {
                continue;
            }


            // =================================================
            // LOGO
            // =================================================

            if (chave === "logo") {

                canalAtual.logo = valor;

                continue;
            }


            // =================================================
            // CATEGORIA
            // =================================================

            if (chave === "categoria") {

                canalAtual.categoria =
                    valor ||
                    classificarCanal(
                        canalAtual.nome
                    );

                continue;
            }


            // =================================================
            // FONTE
            // =================================================

            if (chave === "fonte") {

                canalAtual.fontes.push({

                    url: valor,

                    referer: "",

                    agente: "",

                    chave: "",

                    qualidade: ""
                });

                continue;
            }


            // =================================================
            // QUALIDADE
            // =================================================

            if (chave === "qualidade") {

                if (
                    canalAtual.fontes.length > 0
                ) {

                    canalAtual.fontes[
                        canalAtual.fontes.length - 1
                    ].qualidade = valor;
                }

                continue;
            }


            // =================================================
            // REFERER
            // =================================================

            if (chave === "referer") {

                if (
                    canalAtual.fontes.length > 0
                ) {

                    canalAtual.fontes[
                        canalAtual.fontes.length - 1
                    ].referer = valor;
                }

                continue;
            }


            // =================================================
            // USER AGENT / AGENTE
            // =================================================

            if (
                chave === "agente" ||
                chave === "user-agent" ||
                chave === "user_agent"
            ) {

                if (
                    canalAtual.fontes.length > 0
                ) {

                    canalAtual.fontes[
                        canalAtual.fontes.length - 1
                    ].agente = valor;
                }

                continue;
            }


            // =================================================
            // CHAVE
            // =================================================

            if (chave === "chave") {

                if (
                    canalAtual.fontes.length > 0
                ) {

                    canalAtual.fontes[
                        canalAtual.fontes.length - 1
                    ].chave = valor;
                }

                continue;
            }
        }


        console.log(
            `📊 Canais encontrados no catálogo: ${canais.length}`
        );


        // =====================================================
        // GERAR M3U
        // =====================================================

        let m3u = "#EXTM3U\n";

        let contadorCanais = 0;

        let contadorFontes = 0;

        const canaisProcessados =
            new Set();


        for (const canal of canais) {

            if (
                !canal.nome ||
                !canal.fontes ||
                canal.fontes.length === 0
            ) {
                continue;
            }


            const nomeNormalizado =
                normalizarNomeCanal(
                    canal.nome
                );


            // =================================================
            // EVITAR CANAIS DUPLICADOS
            // =================================================

            if (
                canaisProcessados.has(
                    nomeNormalizado
                )
            ) {
                continue;
            }

            canaisProcessados.add(
                nomeNormalizado
            );


            const categoria =
                canal.categoria ||
                classificarCanal(
                    canal.nome
                );


            // =================================================
            // FILTRAR FONTES
            // =================================================

            const fontesValidas =
                canal.fontes.filter(fonte => {

                    if (!fonte.url) {
                        return false;
                    }

                    if (
                        !fonte.url.startsWith(
                            "http://"
                        ) &&
                        !fonte.url.startsWith(
                            "https://"
                        )
                    ) {
                        return false;
                    }

                    return true;
                });


            if (
                fontesValidas.length === 0
            ) {
                continue;
            }


            // =================================================
            // CADA FONTE É PRESERVADA
            // =================================================

            for (
                const fonte of fontesValidas
            ) {

                let extinf =
                    "#EXTINF:-1";


                // ------------------------------------------------
                // LOGO
                // ------------------------------------------------

                if (canal.logo) {

                    extinf +=
                        ' tvg-logo="' +
                        canal.logo
                            .replace(/"/g, "'") +
                        '"';
                }


                // ------------------------------------------------
                // GRUPO
                // ------------------------------------------------

                extinf +=
                    ' group-title="' +
                    categoria
                        .replace(/"/g, "'") +
                    '"';


                // ------------------------------------------------
                // QUALIDADE
                // ------------------------------------------------

                if (fonte.qualidade) {

                    extinf +=
                        ' tvg-quality="' +
                        fonte.qualidade
                            .replace(/"/g, "'") +
                        '"';
                }


                // ------------------------------------------------
                // NOME
                // ------------------------------------------------

                extinf +=
                    "," +
                    canal.nome;


                m3u +=
                    extinf +
                    "\n";

                m3u +=
                    fonte.url +
                    "\n";


                contadorFontes++;
            }


            contadorCanais++;
        }


        // =====================================================
        // SALVAR
        // =====================================================

        await fs.writeFile(
            "canais_saimo.m3u",
            m3u,
            "utf8"
        );


        const tamanhoMB =
            (
                Buffer.byteLength(
                    m3u,
                    "utf8"
                ) /
                1024 /
                1024
            ).toFixed(2);


        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            "📺 RESULTADO DOS CANAIS"
        );
        console.log(
            "=========================================="
        );

        console.log(
            `📺 Canais únicos: ${contadorCanais}`
        );

        console.log(
            `🔗 Fontes preservadas: ${contadorFontes}`
        );

        console.log(
            `📦 Tamanho M3U: ${tamanhoMB} MB`
        );

        console.log(
            "=========================================="
        );
        console.log("");


    } catch (e) {

        console.error(
            "❌ Erro nos canais:",
            e.message
        );

        throw e;
    }
}


// ============================================================
// RÁDIOS
// ============================================================

async function processarRadios() {

    console.log(
        "📻 Construindo banco de Rádios..."
    );

    try {

        const radios = [

            {
                id: "saudade",
                nome: "Saudade FM",
                url: "URL_STREAMING_AQUI"
            },

            {
                id: "antena1",
                nome: "Antena 1",
                url: "URL_STREAMING_AQUI"
            },

            {
                id: "89fm",
                nome: "89 FM",
                url: "URL_STREAMING_AQUI"
            }
        ];


        const conteudo =
            "window.CZ_VIDEOS_RADIO = " +
            JSON.stringify(
                radios,
                null,
                2
            ) +
            ";";


        await fs.writeFile(
            "radios_saimo.js",
            conteudo,
            "utf8"
        );


        console.log(
            `✅ radios_saimo.js gerado (${radios.length} estações)`
        );


    } catch (e) {

        console.error(
            "❌ Erro nas rádios:",
            e.message
        );

        throw e;
    }
}


// ============================================================
// PROCESSAR VOD
// ============================================================

async function processarVOD() {

    console.log(
        "🎬 Baixando índice, gêneros e construindo catálogos..."
    );


    // ==========================================================
    // GÊNEROS
    // ==========================================================

    const generosMap =
        await carregarGeneros();


    // ==========================================================
    // ÍNDICE
    // ==========================================================

    const resIndice =
        await fetch(
            GITHUB_RAW_BASE +
            "vod/indice.txt"
        );


    if (!resIndice.ok) {

        throw new Error(
            "Falha ao baixar índice VOD"
        );
    }


    const textoIndice =
        await resIndice.text();


    const bases = {};

    const gavetas = [];


    // ==========================================================
    // LER ÍNDICE
    // ==========================================================

    textoIndice
        .split(/\r?\n/)
        .forEach(linha => {

            linha = linha.trim();

            if (!linha) {
                return;
            }


            // --------------------------------------------------
            // BASE
            // --------------------------------------------------

            if (
                linha.startsWith(
                    "base:"
                )
            ) {

                const partes =
                    linha
                        .replace(
                            "base:",
                            ""
                        )
                        .trim()
                        .split(/\s+/);


                if (
                    partes.length >= 2
                ) {

                    bases[
                        partes[0]
                    ] = partes[1];
                }


                return;
            }


            // --------------------------------------------------
            // GAVETA
            // --------------------------------------------------

            if (
                linha.includes("\t")
            ) {

                const campos =
                    linha.split("\t");


                if (campos[0]) {

                    gavetas.push({

                        letra:
                            campos[0],

                        filmes:
                            parseInt(
                                campos[1] ||
                                "0"
                            ),

                        series:
                            parseInt(
                                campos[2] ||
                                "0"
                            )
                    });
                }
            }
        });


    // ==========================================================
    // MONTAR URL
    // ==========================================================

    function montarUrl(valor) {

        if (!valor) {
            return null;
        }


        if (
            valor.startsWith(
                "http"
            )
        ) {
            return valor;
        }


        const partes =
            valor.split(":");


        if (
            partes.length < 2
        ) {
            return null;
        }


        const numero =
            partes[0].trim();


        const resto =
            partes
                .slice(1)
                .join(":")
                .trim();


        const base =
            bases[numero];


        if (
            !base ||
            !resto
        ) {
            return null;
        }


        return resto.includes(".")
            ? base + resto
            : base + resto + ".mp4";
    }


    // ==========================================================
    // ARRAYS FINAIS
    // ==========================================================

    const filmesCartoonzine = [];

    const seriesCartoonzine = [];


    // ==========================================================
    // FILMES
    // ==========================================================

    for (
        const g of gavetas
    ) {

        if (
            g.filmes <= 0
        ) {
            continue;
        }


        const letra =
            g.letra;


        const nomeArquivo =
            letra === "#"
                ? "%23"
                : letra;


        console.log(
            `🎥 Processando Filmes da letra: ${letra}...`
        );


        try {

            const resFilmes =
                await fetch(
                    GITHUB_RAW_BASE +
                    "vod/filmes-" +
                    nomeArquivo +
                    ".txt"
                );


            if (!resFilmes.ok) {
                continue;
            }


            const textoFilmes =
                await resFilmes.text();


            const linhas =
                textoFilmes.split(
                    /\r?\n/
                );


            for (
                let linha of linhas
            ) {

                if (
                    !linha.trim()
                ) {
                    continue;
                }


                const campos =
                    linha.split("\t");


                if (
                    campos.length < 2 ||
                    !campos[0]
                ) {
                    continue;
                }


                const tituloCompleto =
                    campos[0];


                const regexAno =
                    /\s*\(\d{4}\)$/;


                const tituloSemAno =
                    tituloCompleto
                        .replace(
                            regexAno,
                            ""
                        )
                        .trim();


                const linksParte =
                    campos.find(
                        c =>
                            c.includes("=")
                    );


                if (!linksParte) {
                    continue;
                }


                const urlBruta =
                    linksParte
                        .split("=")[1]
                        ?.split(",")[0];


                if (!urlBruta) {
                    continue;
                }


                const urlFinal =
                    montarUrl(
                        urlBruta
                    );


                if (!urlFinal) {
                    continue;
                }


                await delay(30);


                const tmdbData =
                    await fetchTMDB(
                        tituloCompleto,
                        false
                    );


                const generoTxt =
                    generosMap.get(
                        "f|" +
                        tituloSemAno
                    ) ||
                    "Filme";


                filmesCartoonzine.push({

                    cat: "Filmes",

                    title:
                        tituloCompleto,

                    desc:
                        tmdbData.desc,

                    thumb:
                        tmdbData.thumb,

                    bannerThumb:
                        tmdbData.bannerThumb,

                    url:
                        urlFinal,

                    year:
                        tmdbData.year,

                    genre:
                        generoTxt
                });
            }


        } catch (e) {

            console.warn(
                `⚠️ Erro nos filmes da letra ${letra}:`,
                e.message
            );
        }
    }


    // ==========================================================
    // SÉRIES
    // ==========================================================

    for (
        const g of gavetas
    ) {

        if (
            g.series <= 0
        ) {
            continue;
        }


        const letra =
            g.letra;


        const nomeArquivo =
            letra === "#"
                ? "%23"
                : letra;


        console.log(
            `📺 Processando Séries da letra: ${letra}...`
        );


        try {

            const resSeriesIdx =
                await fetch(
                    GITHUB_RAW_BASE +
                    "vod/series-" +
                    nomeArquivo +
                    ".txt"
                );


            if (
                !resSeriesIdx.ok
            ) {
                continue;
            }


            const textoSeriesIdx =
                await resSeriesIdx.text();


            const pedacosSet =
                new Set();


            textoSeriesIdx
                .split(/\r?\n/)
                .forEach(linha => {

                    const campos =
                        linha.split("\t");


                    if (
                        campos.length >= 3 &&
                        campos[2]
                    ) {

                        pedacosSet.add(
                            campos[2].trim()
                        );
                    }
                });


            // ==================================================
            // CADA PEDACINHO DA SÉRIE
            // ==================================================

            for (
                const pedaco of pedacosSet
            ) {

                const resPedaco =
                    await fetch(
                        GITHUB_RAW_BASE +
                        "vod/series-" +
                        nomeArquivo +
                        "-" +
                        pedaco +
                        ".txt"
                    );


                if (
                    !resPedaco.ok
                ) {
                    continue;
                }


                const textoPedaco =
                    await resPedaco.text();


                const linhasPedaco =
                    textoPedaco.split(
                        /\r?\n/
                    );


                let serieAtual =
                    null;


                // ==================================================
                // SALVAR SÉRIE
                // ==================================================

                const salvarSerieAtual =
                    () => {

                        if (
                            !serieAtual
                        ) {
                            return;
                        }


                        serieAtual.seasons =
                            Object.keys(
                                serieAtual.seasonsMap
                            )
                                .map(
                                    sNum => ({

                                        season:
                                            parseInt(
                                                sNum
                                            ),

                                        episodes:
                                            serieAtual
                                                .seasonsMap[
                                                    sNum
                                                ]
                                    })
                                );


                        delete
                            serieAtual.seasonsMap;


                        if (
                            serieAtual.seasons.length > 0
                        ) {

                            seriesCartoonzine.push(
                                serieAtual
                            );
                        }
                    };


                // ==================================================
                // PROCESSAR LINHAS
                // ==================================================

                for (
                    let linha of linhasPedaco
                ) {

                    linha =
                        linha.trim();


                    if (!linha) {
                        continue;
                    }


                    // ==============================================
                    // NOVA SÉRIE
                    // ==============================================

                    if (
                        linha.startsWith("@")
                    ) {

                        salvarSerieAtual();


                        const camposCabecalho =
                            linha
                                .substring(1)
                                .split("\t");


                        const tituloSerie =
                            camposCabecalho[0] ||
                            "";


                        const anoSerie =
                            camposCabecalho[1] ||
                            "";


                        await delay(30);


                        const tmdbData =
                            await fetchTMDB(
                                tituloSerie,
                                true
                            );


                        const generoTxt =
                            generosMap.get(
                                "s|" +
                                tituloSerie
                            ) ||
                            "Série";


                        serieAtual = {

                            cat: "Séries",

                            title:
                                tituloSerie,

                            desc:
                                tmdbData.desc,

                            thumb:
                                tmdbData.thumb,

                            bannerThumb:
                                tmdbData.bannerThumb,

                            year:
                                anoSerie ||
                                tmdbData.year,

                            genre:
                                generoTxt,

                            seasonsMap: {}
                        };


                    } else if (
                        serieAtual
                    ) {

                        // ==========================================
                        // EPISÓDIO
                        // ==========================================

                        const camposEp =
                            linha.split("\t");


                        if (
                            camposEp.length >= 4
                        ) {

                            const tempNum =
                                parseInt(
                                    camposEp[0]
                                ) || 1;


                            const epNum =
                                parseInt(
                                    camposEp[1]
                                ) || 1;


                            const urlBruta =
                                camposEp[3]
                                    .split(",")[0];


                            const urlFinal =
                                montarUrl(
                                    urlBruta
                                );


                            if (
                                urlFinal
                            ) {

                                if (
                                    !serieAtual
                                        .seasonsMap[
                                            tempNum
                                        ]
                                ) {

                                    serieAtual
                                        .seasonsMap[
                                            tempNum
                                        ] = [];
                                }


                                serieAtual
                                    .seasonsMap[
                                        tempNum
                                    ]
                                    .push({

                                        season:
                                            tempNum,

                                        episode:
                                            epNum,

                                        url:
                                            urlFinal
                                    });
                            }
                        }
                    }
                }


                // ==================================================
                // SALVAR ÚLTIMA SÉRIE DO ARQUIVO
                // ==================================================

                salvarSerieAtual();
            }


        } catch (e) {

            console.warn(
                `⚠️ Erro nas séries da letra ${letra}:`,
                e.message
            );
        }
    }


    // ==========================================================
    // SALVAR FILMES
    // ==========================================================

    await fs.writeFile(
        "filmes_saimo.json",
        JSON.stringify(
            filmesCartoonzine,
            null,
            2
        ),
        "utf8"
    );


    // ==========================================================
    // SALVAR SÉRIES
    // ==========================================================

    await fs.writeFile(
        "series_saimo.json",
        JSON.stringify(
            seriesCartoonzine,
            null,
            2
        ),
        "utf8"
    );


    // ==========================================================
    // RESULTADO
    // ==========================================================

    console.log("");

    console.log(
        "=========================================="
    );

    console.log(
        "🎬 RESULTADO VOD"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `🎥 Filmes: ${filmesCartoonzine.length}`
    );

    console.log(
        `📺 Séries: ${seriesCartoonzine.length}`
    );

    console.log(
        "=========================================="
    );

    console.log("");
}


// ============================================================
// VALIDAÇÃO FINAL
// ============================================================

async function validarArquivosGerados() {

    console.log(
        "🔎 Validando arquivos gerados..."
    );


    // ==========================================================
    // CANAIS
    // ==========================================================

    const canais =
        await fs.readFile(
            "canais_saimo.m3u",
            "utf8"
        );


    const quantidadeCanais =
        (
            canais.match(
                /^#EXTINF:/gm
            ) || []
        ).length;


    // ==========================================================
    // FILMES
    // ==========================================================

    const filmes =
        JSON.parse(
            await fs.readFile(
                "filmes_saimo.json",
                "utf8"
            )
        );


    // ==========================================================
    // SÉRIES
    // ==========================================================

    const series =
        JSON.parse(
            await fs.readFile(
                "series_saimo.json",
                "utf8"
            )
        );


    console.log("");

    console.log(
        "=========================================="
    );

    console.log(
        "🔎 VALIDAÇÃO FINAL"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `📺 Entradas M3U: ${quantidadeCanais}`
    );

    console.log(
        `🎥 Filmes: ${filmes.length}`
    );

    console.log(
        `📺 Séries: ${series.length}`
    );

    console.log(
        "=========================================="
    );


    // ==========================================================
    // NÃO PERMITIR BD VAZIA
    // ==========================================================

    if (
        quantidadeCanais < 100
    ) {

        throw new Error(
            `❌ Apenas ${quantidadeCanais} entradas de canais foram geradas. Atualização cancelada para proteger a BD anterior.`
        );
    }


    if (
        filmes.length === 0
    ) {

        throw new Error(
            "❌ Nenhum filme foi gerado. Atualização cancelada."
        );
    }


    if (
        series.length === 0
    ) {

        throw new Error(
            "❌ Nenhuma série foi gerada. Atualização cancelada."
        );
    }


    console.log(
        "✅ Validação concluída com sucesso!"
    );
}


// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

(async () => {

    try {

        console.log("");
        console.log(
            "🚀 CARTOONZINE SM BRIDGE"
        );
        console.log(
            "=========================================="
        );
        console.log("");


        // ======================================================
        // 1. CANAIS
        // ======================================================

        await processarCanais();


        // ======================================================
        // 2. RÁDIOS
        // ======================================================

        await processarRadios();


        // ======================================================
        // 3. FILMES + SÉRIES
        // ======================================================

        await processarVOD();


        // ======================================================
        // 4. VALIDAR
        // ======================================================

        await validarArquivosGerados();


        // ======================================================
        // FINAL
        // ======================================================

        console.log("");

        console.log(
            "=========================================="
        );

        console.log(
            "🚀 TUDO CONCLUÍDO COM SUCESSO!"
        );

        console.log(
            "=========================================="
        );

        console.log("");

    } catch (e) {

        console.error("");

        console.error(
            "=========================================="
        );

        console.error(
            "❌ ERRO FATAL"
        );

        console.error(
            "=========================================="
        );

        console.error(
            e.message
        );

        console.error("");

        process.exit(1);
    }

})();
})();
