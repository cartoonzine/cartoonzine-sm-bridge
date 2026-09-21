import fs from 'fs/promises';

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";
const TMDB_KEY = process.env.TMDB_KEY || "15d2ea6d0dc1d476efbca3eba2b9bbfb";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Função para respeitar o limite da API do TMDB
const delay = ms => new Promise(r => setTimeout(r, ms));

// Tira marcações como [L], (2024), 4K para o TMDB achar o filme
function limparTituloParaBusca(titulo) {
    return titulo.replace(/\s*\(\d{4}\)|\s*\[.*?\]|\b(4K|1080p|UHD|FHD)\b/gi, '').trim();
}

// 1. BUSCA DE METADADOS NO TMDB
async function fetchTMDB(titulo, isSerie = false) {
    const tipo = isSerie ? 'tv' : 'movie';
    const query = encodeURIComponent(limparTituloParaBusca(titulo));
    const url = `${TMDB_BASE}/search/${tipo}?query=${query}&api_key=${TMDB_KEY}&language=pt-BR`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const item = data.results[0]; // Pega o resultado mais relevante
            return {
                desc: item.overview || "Sinopse não disponível.",
                thumb: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : "",
                bannerThumb: item.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : "",
                year: (item.release_date || item.first_air_date || "").substring(0, 4)
            };
        }
    } catch (e) {
        console.error(`Erro no TMDB para: ${titulo}`);
    }
    return { desc: "Sinopse em breve...", thumb: "", bannerThumb: "", year: "" };
}

// 2. BUSCA DO DICIONÁRIO DE GÊNEROS (generos.txt)
async function carregarGeneros() {
    const mapa = new Map();
    try {
        const res = await fetch(`${GITHUB_RAW_BASE}vod/generos.txt`);
        const texto = await res.text();
        texto.split('\n').forEach(linha => {
            if (linha.startsWith('#')) return;
            const campos = linha.split('\t');
            if (campos.length >= 3) {
                // Salva "f|Titulo" ou "s|Titulo" e pega o primeiro gênero da lista
                mapa.set(`${campos[0]}|${campos[1]}`, campos[2].split(',')[0].trim());
            }
        });
    } catch (e) {}
    return mapa;
}

// 3. CATEGORIZADOR DE CANAIS (Baseado no epg.rs)
function classificarCanal(nome) {
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

// 4. PROCESSAMENTO DE TV AO VIVO
async function processarCanais() {
    console.log("📺 Baixando e categorizando canais...");
    const res = await fetch(`${GITHUB_RAW_BASE}catalogo.txt`);
    const texto = await res.text();
    
    let m3u = "#EXTM3U\n";
    let canalAtual = {};

    for (let linha of texto.split('\n')) {
        linha = linha.trim();
        if (!linha || linha.startsWith('#')) continue;

        const partes = linha.split(':');
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
            // Filtra links .mpd (ClearKey/DRM) que geralmente não tocam em players comuns
            if (canalAtual.nome && canalAtual.url && !canalAtual.url.includes(".mpd")) {
                m3u += `#EXTINF:-1 tvg-logo="${canalAtual.logo}" group-title="${canalAtual.categoria}",${canalAtual.nome}\n${canalAtual.url}\n`;
            }
        }
    }

    await fs.writeFile('canais_saimo.m3u', m3u);
    console.log("✅ canais_saimo.m3u gerado limpo e categorizado!");
}

// 5. PROCESSAMENTO DE VOD (Filmes com TMDB)
async function processarVOD() {
    console.log("🎬 Baixando índice, gêneros e construindo VOD...");
    const generosMap = await carregarGeneros();
    
    const resIndice = await fetch(`${GITHUB_RAW_BASE}vod/indice.txt`);
    const textoIndice = await resIndice.text();
    const bases = {};
    const letrasFilmes = [];
    
    textoIndice.split('\n').forEach(linha => {
        if (linha.startsWith("base:")) {
            const partes = linha.replace("base:", "").trim().split(' ');
            bases[partes[0]] = partes[1];
        } else if (linha.includes('\t')) {
            const letra = linha.split('\t')[0];
            if (letra) letrasFilmes.push(letra);
        }
    });

    function montarUrl(valor) {
        if (valor.startsWith("http")) return valor;
        const [numero, resto] = valor.split(':');
        const base = bases[numero.trim()];
        if (!base) return null;
        return resto.includes('.') ? `${base}${resto}` : `${base}${resto}.mp4`;
    }

    const vodCartoonzine = [];
    
    // Alerta: Para testes rápidos, limite as letras. O TMDB bloqueia se houver muitas requisições por segundo.
    // Trocado ['A'] por um subconjunto ['A', 'B', 'C'] para demonstrar a escala.
    for (let letra of ['A', 'B', 'C']) { 
        console.log(`Buscando filmes da letra: ${letra}`);
        const resFilmes = await fetch(`${GITHUB_RAW_BASE}vod/filmes-${letra}.txt`);
        if (!resFilmes.ok) continue;
        
        const textoFilmes = await resFilmes.text();
        const linhas = textoFilmes.split('\n');

        for (let linha of linhas) {
            const campos = linha.split('\t');
            if (campos.length < 2 || !campos[0]) continue;
            
            const tituloCompleto = campos[0];
            const tituloSemAno = tituloCompleto.replace(/\s*\(\d{4}\)$/, '').trim();
            
            const linksParte = campos[1]; 
            if (!linksParte.includes('=')) continue;
            
            const urlBruta = linksParte.split('=')[1].split(',')[0];
            const urlFinal = montarUrl(urlBruta);
            
            if (urlFinal) {
                // Chamada à API com atraso de 100ms para evitar Rate Limit (Erro 429)
                await delay(100); 
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
                    destaque: 
                });
            }
        }
    }

    await fs.writeFile('vod_saimo.json', JSON.stringify(vodCartoonzine, null, 2));
    console.log(`✅ vod_saimo.json gerado com ${vodCartoonzine.length} títulos, capas e sinopses!`);
}

(async () => {
    try {
        await processarCanais();
        await processarVOD();
        console.log("🚀 Todos os dados processados com sucesso!");
    } catch (e) {
        console.error("❌ Erro fatal:", e);
        process.exit(1);
    }
})();
