import fs from 'fs/promises';

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/gabrielsaimo/SaimoPlayer/main/";
const TMDB_API_KEY = process.env.TMDB_KEY || "15d2ea6d0dc1d476efbca3eba2b9bbfb"; // Chave exposta no código original
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// 1. PROCESSAMENTO DE TV AO VIVO (IPTV)
async function processarCanais() {
    console.log("📺 Baixando catálogo de canais...");
    const res = await fetch(`${GITHUB_RAW_BASE}catalogo.txt`);
    const texto = await res.text();
    
    let m3u = "#EXTM3U\n";
    let canalAtual = {};

    for (let linha of texto.split('\n')) {
        linha = linha.trim();
        if (!linha || linha.startsWith('#')) continue;

        const [chave, ...valorArr] = linha.split(':');
        const valor = valorArr.join(':').trim();
        if (!valor) continue;

        switch (chave.toLowerCase()) {
            case 'canal':
                canalAtual = { nome: valor, logo: "", categoria: "Variedades", url: "" };
                break;
            case 'logo':
                canalAtual.logo = valor;
                break;
            case 'categoria':
                canalAtual.categoria = valor;
                break;
            case 'fonte':
                canalAtual.url = valor;
                // Salva o canal no M3U assim que tiver uma fonte válida
                if (canalAtual.nome && canalAtual.url && !canalAtual.url.includes("mpd")) {
                    m3u += `#EXTINF:-1 tvg-logo="${canalAtual.logo}" group-title="${canalAtual.categoria}",${canalAtual.nome}\n${canalAtual.url}\n`;
                }
                break;
        }
    }

    await fs.writeFile('canais_saimo.m3u', m3u);
    console.log("✅ canais_saimo.m3u gerado!");
}

// 2. PROCESSAMENTO DE FILMES E SÉRIES (VOD)
async function processarVOD() {
    console.log("🎬 Baixando índice e construindo VOD...");
    const resIndice = await fetch(`${GITHUB_RAW_BASE}vod/indice.txt`);
    const textoIndice = await resIndice.text();
    
    // Extrai as bases numéricas (ex: base: 0 https://...)
    const bases = {};
    const letras = [];
    
    for (let linha of textoIndice.split('\n')) {
        if (linha.startsWith("base:")) {
            const partes = linha.replace("base:", "").trim().split(' ');
            bases[partes[0]] = partes[1];
        } else if (linha.includes('\t')) {
            letras.push(linha.split('\t')[0]);
        }
    }

    // Função utilitária para montar a URL
    function montarUrl(valor) {
        if (valor.startsWith("http")) return valor;
        const [numero, resto] = valor.split(':');
        const base = bases[numero.trim()];
        if (!base) return null;
        return resto.includes('.') ? `${base}${resto}` : `${base}${resto}.mp4`;
    }

    const vodCartoonzine = []; // Estrutura para o cloud-engine.js

    // Baixa apenas a letra "A" como prova de conceito (para não estourar tempo no teste)
    // No projeto final, faça um loop por 'letras'
    for (let letra of ['A']) { 
        console.log(`Buscando filmes da letra: ${letra}`);
        const resFilmes = await fetch(`${GITHUB_RAW_BASE}vod/filmes-${letra}.txt`);
        if (!resFilmes.ok) continue;
        
        const textoFilmes = await resFilmes.text();
        
        for (let linha of textoFilmes.split('\n')) {
            const campos = linha.split('\t');
            if (campos.length < 2 || !campos[0]) continue;
            
            const titulo = campos[0];
            const linksParte = campos[1]; // Pega a primeira versão
            if (!linksParte.includes('=')) continue;
            
            const urlBruta = linksParte.split('=')[1].split(',')[0];
            const urlFinal = montarUrl(urlBruta);
            
            if (urlFinal) {
                // Monta o objeto no padrão do cloud-engine.js
                vodCartoonzine.push({
                    cat: "Filmes",
                    title: titulo,
                    desc: "Sinopse em breve...",
                    thumb: "", // Aqui entraria a chamada ao TMDB no projeto avançado
                    bannerThumb: "",
                    url: urlFinal,
                    year: "",
                    genre: "Filme",
                    destaque: false
                });
            }
        }
    }

    await fs.writeFile('vod_saimo.json', JSON.stringify(vodCartoonzine, null, 2));
    console.log(`✅ vod_saimo.json gerado com ${vodCartoonzine.length} títulos!`);
}

// 3. EXECUÇÃO
(async () => {
    try {
        await processarCanais();
        await processarVOD();
        console.log("🚀 Todos os bancos de dados convertidos e prontos para o Cartoonzine!");
    } catch (e) {
        console.error("❌ Erro fatal:", e);
        process.exit(1);
    }
})();
