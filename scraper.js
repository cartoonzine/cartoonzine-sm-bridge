import fs from 'fs/promises';

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";
const TMDB_KEY = process.env.TMDB_KEY || "4a0e81a33a44fc2b682553ef05a5e49e";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const delay = ms => new Promise(r => setTimeout(r, ms));

function limparTituloParaBusca(titulo) {
    if (!titulo) return "";
    const regex = /\s*(\d{4})|\s*\x5B.*?\x5D|\b(4K|1080p|UHD|FHD|HD|SD|LEG|DUB)\b/gi;
    return titulo.replace(regex, '').trim();
}

const tmdbCache = new Map();

async function fetchTMDB(titulo, isSerie = false) {
    const tituloLimpo = limparTituloParaBusca(titulo);
    if (!tituloLimpo) return { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };
    
    const cacheKey = (isSerie ? 's' : 'f') + "|" + tituloLimpo.toLowerCase();
    if (tmdbCache.has(cacheKey)) {
        return tmdbCache.get(cacheKey);
    }
    
    const tipo = isSerie ? 'tv' : 'movie';
    const query = encodeURIComponent(tituloLimpo);
    const url = TMDB_BASE + "/search/" + tipo + "?query=" + query + "&api_key=" + TMDB_KEY + "&language=pt-BR";
    
    let resData = { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const item = data.results[0];
                resData = {
                    desc: item.overview || "Sinopse não disponível.",
                    thumb: item.poster_path ? (TMDB_IMG + item.poster_path) : "",
                    bannerThumb: item.backdrop_path ? (TMDB_IMG + item.backdrop_path) : "",
                    year: (item.release_date || item.first_air_date || "").substring(0, 4)
                };
            }
        }
    } catch (e) {}
    
    tmdbCache.set(cacheKey, resData);
    return resData;
}

async function carregarGeneros() {
    const mapa = new Map();
    try {
        const res = await fetch(GITHUB_RAW_BASE + "vod/generos.txt");
        if (!res.ok) return mapa;
        const texto = await res.text();
        texto.split('\n').forEach(linha => {
            if (linha.startsWith('#')) return;
            const campos = linha.split('\t');
            if (campos.length >= 3) {
                mapa.set(campos[0] + "|" + campos[1], campos[2].split(',')[0].trim());
            }
        });
    } catch (e) {}
    return mapa;
}

function classificarCanal(nome) {
    if (!nome) return "Variedades";
    const n = nome.toLowerCase();
    if (/(sexy hot|playboy|adulto|venus|hustler|private|sex)/.test(n)) return "Adulto";
    if (/(pluto)/.test(n)) return "Pluto TV";
    if (/(espn|sportv|premiere|combate|band sports|cazé|caze|nsports|xsports)/.test(n)) return "Esportes";
    if (/(news|globonews|cnn|record news|jovem pan|terra viva)/.test(n)) return "Notícias";
    if (/(cartoon|nick|discovery kids|gloob|infantil|kids|boomerang)/.test(n)) return "Infantil";
    if (/(discovery|history|animal planet|natgeo|national geographic|investigação)/.test(n)) return "Documentários";
    if (/(hbo|telecine|megapix|paramount|tnt|space|universal|amc|cinemax|star)/.test(n)) return "Filmes e Séries";
    if (/(globo|sbt|record|band|rede tv|redetv|cultura|gazeta)/.test(n)) return "TV Aberta";
    return "Variedades";
}

async function processarCanais() {
    console.log("📺 Baixando e categorizando canais do catálogo curado...");
    let contador = 0;
    
    const todosOsCanais = []; 

    try {
        const res = await fetch(GITHUB_RAW_BASE + "catalogo.txt");
        if (res.ok) {
            const texto = await res.text();
            let canalAtual = null;

            for (let linha of texto.split('\n')) {
                linha = linha.trim();
                if (!linha || linha.startsWith('#')) continue;

                const partes = linha.split(':');
                if (partes.length < 2) continue;

                const chave = partes.shift().trim().toLowerCase();
                const valor = partes.join(':').trim();
                if (!valor) continue;

                if (chave === 'canal') {
                    canalAtual = {
                        nome: valor,
                        logo: "",
                        categoria: classificarCanal(valor),
                        urls: [] 
                    };
                    todosOsCanais.push(canalAtual);
                } else if (canalAtual && chave === 'logo') {
                    if (!canalAtual.logo) canalAtual.logo = valor;
                } else if (canalAtual && chave === 'categoria') {
                    canalAtual.categoria = valor;
                } else if (canalAtual && chave === 'fonte') {
                    canalAtual.urls.push(valor);
                }
            }
        }

        const canaisJSON = [];
        
        for (let canal of todosOsCanais) {
            if (canal.urls.length > 0) {
                contador++;
                
                canaisJSON.push({
                    id: contador.toString(),
                    nome: canal.nome,
                    categoria: canal.categoria,
                    logo: canal.logo,
                    urls: canal.urls 
                });
            }
        }

        await fs.writeFile('canais_saimo.json', JSON.stringify(canaisJSON, null, 2), 'utf8');
        
        console.log(`\n✅ canais_saimo.json gerado com SUCESSO!`);
        console.log(`📺 Canais extraídos: ${contador}`);
        console.log("------------------------------------------\n");

    } catch (e) {
        console.error("Erro nos canais:", e.message);
    }
}

async function processarRadios() {
    console.log("📻 Construindo banco de Rádios...");
    try {
        const radios = [
            { id: "saudade", nome: "Saudade FM", url: "URL_STREAMING_AQUI" },
            { id: "antena1", nome: "Antena 1", url: "URL_STREAMING_AQUI" },
            { id: "89fm", nome: "89 FM", url: "URL_STREAMING_AQUI" }
        ];
        const conteudo = "window.CZ_VIDEOS_RADIO = " + JSON.stringify(radios, null, 2) + ";";
        await fs.writeFile('radios_saimo.js', conteudo);
        console.log("✅ radios_saimo.js gerado (" + radios.length + " estações)");
    } catch (e) {
        console.error("Erro nas rádios:", e.message);
    }
}

async function processarVOD() {
    console.log("🎬 Baixando índice, gêneros e construindo catálogos...");
    const generosMap = await carregarGeneros();
    const resIndice = await fetch(GITHUB_RAW_BASE + "vod/indice.txt");
    if (!resIndice.ok) throw new Error("Falha ao baixar índice VOD");
    const textoIndice = await resIndice.text();
    const bases = {};
    const gavetas = [];
    
    textoIndice.split('\n').forEach(linha => {
        linha = linha.trim();
        if (linha.startsWith("base:")) {
            const partes = linha.replace("base:", "").trim().split(' ');
            if (partes.length >= 2) bases[partes[0]] = partes[1];
        } else if (linha.includes('\t')) {
            const campos = linha.split('\t');
            if (campos[0]) {
                gavetas.push({
                    letra: campos[0],
                    filmes: parseInt(campos[1] || '0'),
                    series: parseInt(campos[2] || '0')
                });
            }
        }
    });
    
    function montarUrl(valor) {
        if (!valor) return null;
        if (valor.startsWith("http")) return valor;
        const partesUrl = valor.split(':');
        if (partesUrl.length < 2) return null;
        const numero = partesUrl[0].trim();
        const resto = partesUrl.slice(1).join(':').trim();
        const base = bases[numero];
        if (!base || !resto) return null;
        return resto.includes('.') ? (base + resto) : (base + resto + ".mp4");
    }
    
    function extrairFontes(campos) {
        const fontes = [];
        for (let campo of campos) {
            if (campo.startsWith("dub=") || campo.startsWith("leg=") || campo.includes('=')) {
                const partes = campo.split('=');
                if (partes.length < 2) continue;
                
                const idioma = partes[0].toLowerCase();
                const isDub = idioma === "dub" || idioma.includes("dublado");
                const urlsBrutas = partes[1].split(',');
                
                for (let urlBruta of urlsBrutas) {
                    const urlFinal = montarUrl(urlBruta);
                    if (urlFinal) {
                        fontes.push({ url: urlFinal, idioma: isDub ? "dublado" : "legendado" });
                    }
                }
            }
        }
        return fontes;
    }

    const filmesCartoonzine = [];
    const seriesCartoonzine = [];
    const adultosVodCartoonzine = []; 
    
    for (let g of gavetas) {
        if (g.filmes <= 0) continue;
        const letra = g.letra;
        const nomeArquivo = letra === '#' ? '%23' : letra;
        console.log("🎥 Processando Filmes da letra: " + letra + "...");
        try {
            const resFilmes = await fetch(GITHUB_RAW_BASE + "vod/filmes-" + nomeArquivo + ".txt");
            if (!resFilmes.ok) continue;
            const textoFilmes = await resFilmes.text();
            
            for (let linha of textoFilmes.split('\n')) {
                if (!linha.trim()) continue;
                const campos = linha.split('\t');
                if (campos.length < 2 || !campos[0]) continue;
                
                const tituloCompleto = campos[0];
                const regexAno = /\s*(\d{4})$/;
                const tituloSemAno = tituloCompleto.replace(regexAno, '').trim();
                
                const fontesFilme = extrairFontes(campos);
                if (fontesFilme.length === 0) continue;
                
                await delay(30);
                const tmdbData = await fetchTMDB(tituloCompleto, false);
                const generoTxt = generosMap.get("f|" + tituloSemAno) || "Filme";
                
                filmesCartoonzine.push({
                    cat: "Filmes",
                    title: tituloCompleto,
                    desc: tmdbData.desc,
                    thumb: tmdbData.thumb,
                    bannerThumb: tmdbData.bannerThumb,
                    year: tmdbData.year,
                    genre: generoTxt,
                    fontes: fontesFilme 
                });
            }
        } catch (e) {}
    }
    
    for (let g of gavetas) {
        if (g.series <= 0) continue;
        const letra = g.letra;
        const nomeArquivo = letra === '#' ? '%23' : letra;
        console.log("📺 Processando Séries da letra: " + letra + "...");
        try {
            const resSeriesIdx = await fetch(GITHUB_RAW_BASE + "vod/series-" + nomeArquivo + ".txt");
            if (!resSeriesIdx.ok) continue;
            const textoSeriesIdx = await resSeriesIdx.text();
            const pedacosSet = new Set();
            textoSeriesIdx.split('\n').forEach(linha => {
                const campos = linha.split('\t');
                if (campos.length >= 3 && campos[2]) pedacosSet.add(campos[2].trim());
            });
            for (let pedaco of pedacosSet) {
                const resPedaco = await fetch(GITHUB_RAW_BASE + "vod/series-" + nomeArquivo + "-" + pedaco + ".txt");
                if (!resPedaco.ok) continue;
                const textoPedaco = await resPedaco.text();
                
                let serieAtual = null;
                const salvarSerieAtual = () => {
                    if (serieAtual) {
                        serieAtual.seasons = Object.keys(serieAtual.seasonsMap).map(sNum => ({
                            season: parseInt(sNum),
                            episodes: serieAtual.seasonsMap[sNum]
                        }));
                        delete serieAtual.seasonsMap;
                        if (serieAtual.seasons.length > 0) seriesCartoonzine.push(serieAtual);
                    }
                };
                
                for (let linha of textoPedaco.split('\n')) {
                    linha = linha.trim();
                    if (!linha) continue;
                    if (linha.startsWith('@')) {
                        salvarSerieAtual();
                        const camposCabecalho = linha.substring(1).split('\t');
                        const tituloSerie = camposCabecalho[0] || "";
                        const anoSerie = camposCabecalho[1] || "";
                        await delay(30);
                        const tmdbData = await fetchTMDB(tituloSerie, true);
                        const generoTxt = generosMap.get("s|" + tituloSerie) || "Série";
                        
                        serieAtual = {
                            cat: "Séries",
                            title: tituloSerie,
                            desc: tmdbData.desc,
                            thumb: tmdbData.thumb,
                            bannerThumb: tmdbData.bannerThumb,
                            year: anoSerie || tmdbData.year,
                            genre: generoTxt,
                            seasonsMap: {}
                        };
                    } else if (serieAtual) {
                        const camposEp = linha.split('\t');
                        if (camposEp.length >= 4) {
                            const tempNum = parseInt(camposEp[0]) || 1;
                            const epNum = parseInt(camposEp[1]) || 1;
                            
                            const idioma = camposEp[2] === "leg" ? "legendado" : "dublado";
                            const urlsBrutas = camposEp[3].split(',');
                            
                            if (!serieAtual.seasonsMap[tempNum]) {
                                serieAtual.seasonsMap[tempNum] = [];
                            }
                            
                            let episodioExistente = serieAtual.seasonsMap[tempNum].find(e => e.episode === epNum);
                            if (!episodioExistente) {
                                episodioExistente = { season: tempNum, episode: epNum, fontes: [] };
                                serieAtual.seasonsMap[tempNum].push(episodioExistente);
                            }
                            
                            for (let urlBruta of urlsBrutas) {
                                const urlFinal = montarUrl(urlBruta);
                                if (urlFinal) {
                                    episodioExistente.fontes.push({ url: urlFinal, idioma: idioma });
                                }
                            }
                        }
                    }
                }
                salvarSerieAtual();
            }
        } catch (e) {}
    }

    for (let g of gavetas) {
        const letra = g.letra;
        const nomeArquivo = letra === '#' ? '%23' : letra;
        console.log("🔞 Processando VOD Adulto da letra: " + letra + "...");
        try {
            const resAdulto = await fetch(GITHUB_RAW_BASE + "vod/reservado-" + nomeArquivo + ".txt");
            if (!resAdulto.ok) continue; 
            const textoAdulto = await resAdulto.text();
            
            for (let linha of textoAdulto.split('\n')) {
                if (!linha.trim()) continue;
                const campos = linha.split('\t');
                if (campos.length < 2 || !campos[0]) continue;
                
                const tituloCompleto = campos[0];
                const fontesFilme = extrairFontes(campos);
                if (fontesFilme.length === 0) continue;
                
                adultosVodCartoonzine.push({
                    cat: "Adulto VOD",
                    title: tituloCompleto,
                    desc: "Conteúdo restrito para maiores de 18 anos.",
                    thumb: "", 
                    bannerThumb: "",
                    year: "",
                    genre: "Adulto",
                    fontes: fontesFilme 
                });
            }
        } catch (e) {}
    }
    
    await fs.writeFile('filmes_saimo.json', JSON.stringify(filmesCartoonzine, null, 2), "utf8");
    await fs.writeFile('series_saimo.json', JSON.stringify(seriesCartoonzine, null, 2), "utf8");
    await fs.writeFile('adultos_vod_saimo.json', JSON.stringify(adultosVodCartoonzine, null, 2), "utf8");
    
    console.log("✅ filmes_saimo.json gerado (" + filmesCartoonzine.length + " títulos)");
    console.log("✅ series_saimo.json gerado (" + seriesCartoonzine.length + " títulos)");
    console.log("✅ adultos_vod_saimo.json gerado (" + adultosVodCartoonzine.length + " títulos)");
}

async function processarDestaques() {
    console.log("🌟 Baixando vitrines da Tela Inicial (Destaques)...");
    
    try {
        const res = await fetch(GITHUB_RAW_BASE + "vod/destaques.txt");
        if (!res.ok) throw new Error("Falha ao baixar destaques.txt");
        
        const texto = await res.text();
        const linhas = texto.split(/\r?\n/);
        
        let capaBase = "https://image.tmdb.org/t/p/w342";
        const destaques = [];
        let filaAtual = null;
        let contadorItens = 0;

        for (let linha of linhas) {
            linha = linha.trim();
            if (!linha || linha.startsWith("#")) continue;

            if (linha.startsWith("capa:")) {
                capaBase = linha.replace("capa:", "").trim();
                continue;
            }

            const campos = linha.split("\t");

            if (campos[0] === "fila" && campos.length >= 2) {
                filaAtual = {
                    titulo: campos[1],
                    itens: []
                };
                destaques.push(filaAtual);
                continue;
            }

            if (filaAtual && (campos[0] === "f" || campos[0] === "s" || campos[0] === "a" || campos[0] === "d")) {
                if (campos.length >= 5) {
                    const tipo = campos[0] === "f" ? "Filme" : campos[0] === "s" ? "Série" : campos[0] === "a" ? "Anime" : "Dorama";
                    const nome = campos[1];
                    const ano = campos[3];
                    const posterPath = campos[4];
                    
                    filaAtual.itens.push({
                        tipo: tipo,
                        titulo: nome,
                        ano: ano,
                        capa: posterPath ? (capaBase + posterPath) : ""
                    });
                    contadorItens++;
                }
            }
        }

        await fs.writeFile('destaques_saimo.json', JSON.stringify(destaques, null, 2), "utf8");
        
        console.log("==========================================");
        console.log("🌟 RESULTADO DESTAQUES");
        console.log("==========================================");
        console.log("✅ destaques_saimo.json gerado!");
        console.log("📺 Fileiras criadas: " + destaques.length);
        console.log("🎬 Total de capas: " + contadorItens);
        console.log("==========================================\n");

    } catch (e) {
        console.warn("⚠️ Erro ao processar destaques:", e.message);
    }
}

(async () => {
    try {
        console.log("\n==========================================");
        console.log("🚀 CARTOONZINE SM BRIDGE");
        console.log("==========================================\n");
        
        await processarCanais();
        await processarRadios(); 
        await processarVOD();
        await processarDestaques();
        
        console.log("\n==========================================");
        console.log("🚀 TUDO CONCLUÍDO COM SUCESSO!");
        console.log("==========================================\n");
    } catch (e) {
        console.error("❌ Erro fatal:", e);
        process.exit(1);
    }
})();
