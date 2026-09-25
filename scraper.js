import fs from 'fs/promises';

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";
const TMDB_KEY = process.env.TMDB_KEY || "15d2ea6d0dc1d476efbca3eba2b9bbfb";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const delay = ms => new Promise(r => setTimeout(r, ms));

function limparTituloParaBusca(titulo) {
    if (!titulo) return "";
    return titulo.replace(/\s*\(\d{4}\)|\s*
$$.*?$$|\b(4K|1080p|UHD|FHD|HD|SD|LEG|DUB)\b/gi, '').trim();}const tmdbCache = new Map();async function fetchTMDB(titulo, isSerie = false) {const tituloLimpo = limparTituloParaBusca(titulo);if (!tituloLimpo) return { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };const cacheKey = `\({isSerie ? 's' : 'f'}|\){tituloLimpo.toLowerCase()}`;
if (tmdbCache.has(cacheKey)) {
    return tmdbCache.get(cacheKey);
}

const tipo = isSerie ? 'tv' : 'movie';
const query = encodeURIComponent(tituloLimpo);
const url = `\({TMDB_BASE}/search/\){tipo}?query=\({query}&api_key=\){TMDB_KEY}&language=pt-BR`;

let resData = { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };

try {
    const res = await fetch(url);
    if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const item = data.results[0];
            resData = {
                desc: item.overview || "Sinopse não disponível.",
                thumb: item.poster_path ? `\({TMDB_IMG}\){item.poster_path}` : "",
                bannerThumb: item.backdrop_path ? `\({TMDB_IMG}\){item.backdrop_path}` : "",
                year: (item.release_date || item.first_air_date || "").substring(0, 4)
            };
        }
    }
} catch (e) {}

tmdbCache.set(cacheKey, resData);
return resData;
}async function carregarGeneros() {const mapa = new Map();try {const res = await fetch(${GITHUB_RAW_BASE}vod/generos.txt);if (!res.ok) return mapa;const texto = await res.text();texto.split('\n').forEach(linha => {if (linha.startsWith('#')) return;const campos = linha.split('\t');if (campos.length >= 3) {mapa.set(\({campos[0]}|\){campos[1]}, campos[2].split(',')[0].trim());}});} catch (e) {}return mapa;}function classificarCanal(nome) {if (!nome) return "Variedades";const n = nome.toLowerCase();if (/(sexy hot|playboy|adulto|venus|hustler|private|sex)/.test(n)) return "Adulto";if (/(pluto)/.test(n)) return "Pluto TV";if (/(espn|sportv|premiere|combate|band sports|cazé|caze|nsports|xsports)/.test(n)) return "Esportes";if (/(news|globonews|cnn|record news|jovem pan|terra viva)/.test(n)) return "Notícias";if (/(cartoon|nick|discovery kids|gloob|infantil|kids|boomerang)/.test(n)) return "Infantil";if (/(discovery|history|animal planet|natgeo|national geographic|investigação)/.test(n)) return "Documentários";if (/(hbo|telecine|megapix|paramount|tnt|space|universal|amc|cinemax|star)/.test(n)) return "Filmes e Séries";if (/(globo|sbt|record|band|rede tv|redetv|cultura|gazeta)/.test(n)) return "TV Aberta";return "Variedades";}async function processarCanais() {console.log("📺 Baixando e categorizando canais...");try {const res = await fetch(${GITHUB_RAW_BASE}catalogo.txt);if (!res.ok) throw new Error("Falha ao baixar catálogo de canais");const texto = await res.text();    let m3u = "#EXTM3U\n";
    let canalAtual = {};

    for (let linha of texto.split('\n')) {
        linha = linha.trim();
        if (!linha || linha.startsWith('#')) continue;

        const partes = linha.split(':');
        if (partes.length < 2) continue;

        const chave = partes.shift().trim().toLowerCase();
        const valor = partes.join(':').trim();
        if (!valor) continue;

        if (chave === 'canal') {
            canalAtual = { nome: valor, logo: "", categoria: classificarCanal(valor), url: "" };
        } else if (chave === 'logo') {
            canalAtual.logo = valor;
        } else if (chave === 'categoria') {
            canalAtual.categoria = valor;
        } else if (chave === 'fonte') {
            canalAtual.url = valor;
            if (canalAtual.nome && canalAtual.url && !canalAtual.url.includes(".mpd")) {
                m3u += `#EXTINF:-1 tvg-logo="\({canalAtual.logo}" group-title="\){canalAtual.categoria}",\({canalAtual.nome}\n\){canalAtual.url}\n`;
            }
        }
    }

    await fs.writeFile('canais_saimo.m3u', m3u);
    console.log("✅ canais_saimo.m3u gerado!");
} catch (e) {
    console.error("Erro nos canais:", e.message);
}
}async function processarVOD() {console.log("🎬 Baixando índice, gêneros e construindo catálogos...");const generosMap = await carregarGeneros();const resIndice = await fetch(`${GITHUB_RAW_BASE}vod/indice.txt`);
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
    return resto.includes('.') ? `\({base}\){resto}` : `\({base}\){resto}.mp4`;
}

const filmesCartoonzine = [];
const seriesCartoonzine = [];

// 1. PROCESSAMENTO DE FILMES
for (let g of gavetas) {
    if (g.filmes <= 0) continue;
    const letra = g.letra;
    const nomeArquivo = letra === '#' ? '%23' : letra;
    console.log(`🎥 Processando Filmes da letra: ${letra}...`);
    
    try {
        const resFilmes = await fetch(`\({GITHUB_RAW_BASE}vod/filmes-\){nomeArquivo}.txt`);
        if (!resFilmes.ok) continue;
        
        const textoFilmes = await resFilmes.text();
        const linhas = textoFilmes.split('\n');

        for (let linha of linhas) {
            if (!linha.trim()) continue;
            const campos = linha.split('\t');
            if (campos.length < 2 || !campos[0]) continue;
            
            const tituloCompleto = campos[0];
            const tituloSemAno = tituloCompleto.replace(/\s*\(\d{4}\)$/, '').trim();
            
            const linksParte = campos.find(c => c.includes('='));
            if (!linksParte) continue;
            
            const urlBruta = linksParte.split('=')[1]?.split(',')[0];
            if (!urlBruta) continue;
            
            const urlFinal = montarUrl(urlBruta);
            if (!urlFinal) continue;
            
            await delay(30);
            const tmdbData = await fetchTMDB(tituloCompleto, false);
            const generoTxt = generosMap.get(`f|${tituloSemAno}`) || "Filme";

            filmesCartoonzine.push({
                cat: "Filmes",
                title: tituloCompleto,
                desc: tmdbData.desc,
                thumb: tmdbData.thumb,
                bannerThumb: tmdbData.bannerThumb,
                url: urlFinal,
                year: tmdbData.year,
                genre: generoTxt,
                destaque: false
            });
        }
    } catch (e) {
        console.warn(`Aviso em filmes (\({letra}):\){e.message}`);
    }
}

// 2. PROCESSAMENTO DE SÉRIES
for (let g of gavetas) {
    if (g.series <= 0) continue;
    const letra = g.letra;
    const nomeArquivo = letra === '#' ? '%23' : letra;
    console.log(`📺 Processando Séries da letra: ${letra}...`);

    try {
        const resSeriesIdx = await fetch(`\({GITHUB_RAW_BASE}vod/series-\){nomeArquivo}.txt`);
        if (!resSeriesIdx.ok) continue;
        const textoSeriesIdx = await resSeriesIdx.text();

        const pedacosSet = new Set();
        textoSeriesIdx.split('\n').forEach(linha => {
            const campos = linha.split('\t');
            if (campos.length >= 3 && campos[2]) {
                pedacosSet.add(campos[2].trim());
            }
        });

        for (let pedaco of pedacosSet) {
            const resPedaco = await fetch(`\({GITHUB_RAW_BASE}vod/series-\){nomeArquivo}-${pedaco}.txt`);
            if (!resPedaco.ok) continue;
            
            const textoPedaco = await resPedaco.text();
            const linhasPedaco = textoPedaco.split('\n');

            let serieAtual = null;

            const salvarSerieAtual = () => {
                if (serieAtual) {
                    serieAtual.seasons = Object.keys(serieAtual.seasonsMap).map(sNum => ({
                        season: parseInt(sNum),
                        episodes: serieAtual.seasonsMap[sNum]
                    }));
                    delete serieAtual.seasonsMap;
                    
                    if (serieAtual.seasons.length > 0) {
                        seriesCartoonzine.push(serieAtual);
                    }
                }
            };

            for (let linha of linhasPedaco) {
                linha = linha.trim();
                if (!linha) continue;

                if (linha.startsWith('@')) {
                    salvarSerieAtual();

                    const camposCabecalho = linha.substring(1).split('\t');
                    const tituloSerie = camposCabecalho[0] || "";
                    const anoSerie = camposCabecalho[1] || "";
                    
                    await delay(30);
                    const tmdbData = await fetchTMDB(tituloSerie, true);
                    const generoTxt = generosMap.get(`s|${tituloSerie}`) || "Série";

                    serieAtual = {
                        cat: "Séries",
                        title: tituloSerie,
                        desc: tmdbData.desc,
                        thumb: tmdbData.thumb,
                        bannerThumb: tmdbData.bannerThumb,
                        year: anoSerie || tmdbData.year,
                        genre: generoTxt,
                        destaque: false,
                        seasonsMap: {}
                    };
                } else if (serieAtual) {
                    const camposEp = linha.split('\t');
                    if (camposEp.length >= 4) {
                        const tempNum = parseInt(camposEp[0]) || 1;
                        const epNum = parseInt(camposEp[1]) || 1;
                        const urlBruta = camposEp[3].split(',')[0];
                        const urlFinal = montarUrl(urlBruta);

                        if (urlFinal) {
                            if (!serieAtual.seasonsMap[tempNum]) {
                                serieAtual.seasonsMap[tempNum] = [];
                            }
                            serieAtual.seasonsMap[tempNum].push({
                                season: tempNum,
                                episode: epNum,
                                url: urlFinal
                            });
                        }
                    }
                }
            }
            salvarSerieAtual();
        }
    } catch (e) {
        console.warn(`Aviso em séries (\({letra}):\){e.message}`);
    }
}

await fs.writeFile('filmes_saimo.json', JSON.stringify(filmesCartoonzine, null, 2));
await fs.writeFile('series_saimo.json', JSON.stringify(seriesCartoonzine, null, 2));

console.log(`✅ filmes_saimo.json gerado (${filmesCartoonzine.length} títulos)`);
console.log(`✅ series_saimo.json gerado (${seriesCartoonzine.length} títulos)`);
}(async () => {try {await processarCanais();await processarVOD();console.log("🚀 Tudo concluído com sucesso!");} catch (e) {console.error("❌ Erro fatal:", e);process.exit(1);}})();
