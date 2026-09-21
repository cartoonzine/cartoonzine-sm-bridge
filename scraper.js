import fs from 'fs/promises';

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";
const TMDB_KEY = process.env.TMDB_KEY || "15d2ea6d0dc1d476efbca3eba2b9bbfb";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const delay = ms => new Promise(r => setTimeout(r, ms));

function limparTituloParaBusca(titulo) {
    if (!titulo) return "";
    return titulo.replace(/\s*\(\d{4}\)|\s*\[.*?\]|\b(4K|1080p|UHD|FHD)\b/gi, '').trim();
}

async function fetchTMDB(titulo, isSerie = false) {
    const tipo = isSerie ? 'tv' : 'movie';
    const query = encodeURIComponent(limparTituloParaBusca(titulo));
    const url = `${TMDB_BASE}/search/${tipo}?query=${query}&api_key=${TMDB_KEY}&language=pt-BR`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) return { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };
        
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const item = data.results[0];
            return {
                desc: item.overview || "Sinopse não disponível.",
                thumb: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
                bannerThumb: item.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : "",
                year: (item.release_date || item.first_air_date || "").substring(0, 4)
            };
        }
    } catch (e) {
        // Silencia erro e retorna valores padrão para não travar
    }
    return { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };
}

async function carregarGeneros() {
    const mapa = new Map();
    try {
        const res = await fetch(`${GITHUB_RAW_BASE}vod/generos.txt`);
        if (!res.ok) return mapa;
        const texto = await res.text();
        texto.split('\n').forEach(linha => {
            if (linha.startsWith('#')) return;
            const campos = linha.split('\t');
            if (campos.length >= 3) {
                mapa.set(`${campos[0]}|${campos[1]}`, campos[2].split(',')[0].trim());
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
    console.log("📺 Baixando e categorizando canais...");
    try {
        const res = await fetch(`${GITHUB_RAW_BASE}catalogo.txt`);
        if (!res.ok) throw new Error("Falha ao baixar catálogo de canais");
        const texto = await res.text();
        
        let m3u = "#EXTM3U\n";
        let canalAtual = {};

        for (let linha of texto.split('\n')) {
            linha = linha.trim();
            if (!linha || linha.startsWith('#')) continue;

            const partes = linha.split(':');
            if (partes.length < 2) continue; // Proteção contra linhas sem ':'

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
                    m3u += `#EXTINF:-1 tvg-logo="${canalAtual.logo}" group-title="${canalAtual.categoria}",${canalAtual.nome}\n${canalAtual.url}\n`;
                }
            }
        }

        await fs.writeFile('canais_saimo.m3u', m3u);
        console.log("✅ canais_saimo.m3u gerado!");
    } catch (e) {
        console.error("Erro nos canais:", e.message);
    }
}

async function processarVOD() {
    console.log("🎬 Baixando índice, gêneros e construindo VOD...");
    const generosMap = await carregarGeneros();
    
    const resIndice = await fetch(`${GITHUB_RAW_BASE}vod/indice.txt`);
    if (!resIndice.ok) throw new Error("Falha ao baixar índice VOD");
    const textoIndice = await resIndice.text();
    
    const bases = {};
    
    textoIndice.split('\n').forEach(linha => {
        if (linha.startsWith("base:")) {
            const partes = linha.replace("base:", "").trim().split(' ');
            if (partes.length >= 2) bases[partes[0]] = partes[1];
        }
    });

    function montarUrl(valor) {
        if (!valor) return null;
        if (valor.startsWith("http")) return valor;
        
        const partesUrl = valor.split(':');
        if (partesUrl.length < 2) return null; // Linha inválida
        
        const numero = partesUrl[0].trim();
        const resto = partesUrl.slice(1).join(':').trim();
        const base = bases[numero];
        
        if (!base || !resto) return null; // Base não mapeada
        return resto.includes('.') ? `${base}${resto}` : `${base}${resto}.mp4`;
    }

    const vodCartoonzine = [];
    
    // Alerta: Ainda limitado a 3 letras para você testar com sucesso sem o TMDB te banir por volume
    for (let letra of ['A', 'B', 'C']) { 
        console.log(`Buscando filmes da letra: ${letra}`);
        const resFilmes = await fetch(`${GITHUB_RAW_BASE}vod/filmes-${letra}.txt`);
        if (!resFilmes.ok) continue;
        
        const textoFilmes = await resFilmes.text();
        const linhas = textoFilmes.split('\n');

        for (let linha of linhas) {
            try {
                if (!linha.trim()) continue;
                
                const campos = linha.split('\t');
                if (campos.length < 2 || !campos[0]) continue;
                
                const tituloCompleto = campos[0];
                const tituloSemAno = tituloCompleto.replace(/\s*\(\d{4}\)$/, '').trim();
                
                // Pega a coluna que contém os links (geralmente tem "dub=" ou "leg=")
                const linksParte = campos.find(c => c.includes('='));
                if (!linksParte) continue;
                
                const urlBruta = linksParte.split('=')[1]?.split(',')[0];
                if (!urlBruta) continue;
                
                const urlFinal = montarUrl(urlBruta);
                if (!urlFinal) continue;
                
                await delay(120); // Respeito rigoroso ao limite da API do TMDB
                const tmdbData = await fetchTMDB(tituloCompleto, false);
                const generoTxt = generosMap.get(`f|${tituloSemAno}`) || "Filme";

                vodCartoonzine.push({
                    cat: "Filmes",
                    title: tituloCompleto,
                    desc: tmdbData.desc,
                    thumb: tmdbData.thumb,
                    bannerThumb: tmdbData.bannerThumb,
                    url: urlFinal,
                    year: tmdbData.year,
                    genre: generoTxt,
                });
            } catch (errLine) {
                // Se um único filme der erro bizarro, ele falha aqui e o laço 'for' continua para o próximo filme
                console.warn(`Erro pulando linha do filme: ${errLine.message}`);
            }
        }
    }

    await fs.writeFile('vod_saimo.json', JSON.stringify(vodCartoonzine, null, 2));
    console.log(`✅ vod_saimo.json gerado com ${vodCartoonzine.length} títulos!`);
}

(async () => {
    try {
        await processarCanais();
        await processarVOD();
        console.log("🚀 Tudo concluído com sucesso!");
    } catch (e) {
        console.error("❌ Erro fatal:", e);
        process.exit(1);
    }
})();
