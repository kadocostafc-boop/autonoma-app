// public/js/clientes.js — busca com cidade detectada, autocomplete de bairros/serviços, cards verticais
(function(){
  const $ = (id)=> document.getElementById(id);

  const cards = $('cards');
  const empty = $('empty');
  const cityName = $('cityName');
  const changeCityBtn = $('changeCityBtn');
  const btnBuscar = $('btnBuscar');
  const btnLimpar = $('btnLimpar');
  const statusTxt = $('statusTxt');
  const dlBairros = $('lista-bairros');
  const dlServicos = $('lista-servicos');
  const inputBairro = $('bairro');
  const inputServico = $('servico');

  const cityModal = $('cityModal');
  const cidadeInput = $('cidadeInput');
  const dlCidades = $('lista-cidades');
  const salvarCidade = $('salvarCidade');
  const fecharCidade = $('fecharCidade');

  // Base de serviços (será mesclada com os existentes do banco)
  const BASE_SERVICOS = [
    "Bombeiro hidráulico","Encanador","Eletricista","Pintor","Pedreiro","Gesseiro","Marceneiro","Serralheiro",
    "Técnico de informática","Desenvolvedor","Designer","Fotógrafo","Videomaker","DJ","Garçom","Segurança",
    "Manicure","Cabeleireiro","Maquiadora","Esteticista","Personal trainer","Professor particular","Babá",
    "Cuidador de idosos","Diarista","Passadeira","Motorista","Transportes","Montador de móveis","Jardinagem",
    "Climatização (ar-condicionado)","Refrigeração","Soldador","Telhadista","Vidraceiro","Chaveiro",
    "Consultor","Marketing digital","Social media","Advogado","Contador"
  ];

  let STATE = {
    userLat: null,
    userLng: null,
    cidade: "",         // cidade ativa (ex.: "Rio de Janeiro/RJ" ou "Rio de Janeiro")
    cidades: [],        // lista de cidades do /api/cidades
    bairros: [],        // bairros da cidade ativa
    servicos: [],       // serviços (base + dos profissionais)
    lastQuery: null
  };

  // ---------- Utils ----------
  function starBar(r){
    const n = Math.round(Number(r)||0);
    return "★".repeat(n) + "☆".repeat(5-n);
  }
  function km1(v){
    if (v==null || !isFinite(v)) return "";
    if (v < 1) return (v*1000).toFixed(0)+" m";
    return v.toFixed(1)+" km";
  }
  function openCityModal(){ cityModal.style.display='flex'; setTimeout(()=> cidadeInput.focus(), 50); }
  function closeCityModal(){ cityModal.style.display='none'; }

  // ---------- Fetch helpers ----------
  async function fetchJSON(url){
    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  function qs(obj){ return new URLSearchParams(obj).toString(); }

  // ---------- Carrega cidades do backend ----------
  async function loadCidades(){
    const data = await fetchJSON('/api/cidades');
    // Expor "Cidade/UF" para datalist — e também só cidade (sem UF) como opção auxiliar
    const items = (data.items||[]);
    STATE.cidades = items.map(x=> x.key); // "Campinas/SP"
    const extras = items.map(x=> x.cidade); // "Campinas"
    const all = Array.from(new Set(STATE.cidades.concat(extras))).sort((a,b)=> a.localeCompare(b, 'pt-BR'));
    dlCidades.innerHTML = all.map(c=> `<option value="${c}">`).join('');
  }

  // ---------- Carrega serviços (base + existentes no banco) ----------
  async function loadServicos(){
    const set = new Set(BASE_SERVICOS.map(s=>s.trim()).filter(Boolean));
    // amostra de até 1000 profissionais para coletar serviços/profissões distintos
    let page=1, pages=1;
    while(page<=pages && page<=10){
      const data = await fetchJSON('/api/profissionais?'+qs({ page, limit:100, sort:'recent', dir:'desc' }));
      (data.items||[]).forEach(p=>{
        const s = (p.servico || p.profissao || "").trim();
        if (s) set.add(s);
      });
      pages = data.pages || 1; page++;
    }
    STATE.servicos = Array.from(set).sort((a,b)=> a.localeCompare(b, 'pt-BR'));
    dlServicos.innerHTML = STATE.servicos.map(s=> `<option value="${s}">`).join('');
  }

  // ---------- Carrega bairros da cidade ativa ----------
  async function loadBairrosDaCidade(){
    // cidade pode vir como "Rio de Janeiro/RJ" ou apenas "Rio de Janeiro"
    // Tentamos primeiro como key, se não vier UF, backend resolve insensível
    if (!STATE.cidade) { dlBairros.innerHTML = ""; STATE.bairros=[]; return; }

    // Se usuário digitou só "Cidade", tenta com e sem UF
    // O endpoint aceita ?key=Cidade/UF ou ?cidade=Cidade&uf=UF
    let query = '';
    if (STATE.cidade.includes('/')) {
      query = '?key=' + encodeURIComponent(STATE.cidade);
    } else {
      // tenta só cidade, backend fará busca insensível e devolverá match exato
      query = '?cidade=' + encodeURIComponent(STATE.cidade);
    }

    const data = await fetchJSON('/api/bairros' + query);
    const bairros = (data.bairros || []);
    STATE.bairros = bairros.slice(); // todos, sem limite
    dlBairros.innerHTML = STATE.bairros.map(b=> `<option value="${b}">`).join('');
  }

  // ---------- Heurística para detectar cidade via geolocalização ----------
  function detectCidadeViaGeo(){
    return new Promise((resolve)=>{
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(async (pos)=>{
        STATE.userLat = pos.coords.latitude;
        STATE.userLng = pos.coords.longitude;

        // Busca uma amostra para inferir cidade mais próxima (com lat/lng salvos)
        const snap = await fetchJSON('/api/profissionais?'+qs({ page:1, limit:200, sort:'recent', dir:'desc' }));
        const byCity = {};
        (snap.items||[]).forEach(p=>{
          if (!p.cidade) return;
          (byCity[p.cidade] ||= []).push(p);
        });

        function haversineKm(aLat,aLng,bLat,bLng){
          if (![aLat,aLng,bLat,bLng].every(Number.isFinite)) return null;
          const R=6371, t=d=>d*Math.PI/180;
          const dLat=t(bLat-aLat), dLng=t(bLng-aLng);
          const lat1=t(aLat), lat2=t(bLat);
          const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
          return 2*R*Math.asin(Math.sqrt(x));
        }

        let bestCity = null, bestAvg = Infinity;
        for (const cidade of Object.keys(byCity)){
          const list = byCity[cidade].filter(x=> Number.isFinite(x.lat) && Number.isFinite(x.lng));
          if (!list.length) continue;
          const avg = list.reduce((acc,p)=> acc + (haversineKm(STATE.userLat,STATE.userLng,p.lat,p.lng)||9999), 0) / list.length;
          if (avg < bestAvg){ bestAvg = avg; bestCity = cidade; }
        }
        resolve(bestCity);
      }, ()=> resolve(null), { enableHighAccuracy:false, maximumAge:300000, timeout:8000 });
    });
  }

  // ---------- Render cards ----------
  function render(items){
    cards.innerHTML = "";
    if (!items || !items.length){ empty.style.display = ""; return; }
    empty.style.display = "none";

    const frag = document.createDocumentFragment();
    items.forEach(p=>{
      const foto = p.foto || "https://via.placeholder.com/200?text=Foto";
      const serv = p.servico || p.profissao || "Serviço";
      const rating = Number(p.rating||0);
      const distTxt = (p.distanceKm!=null) ? `Distância ${km1(p.distanceKm)}` : "";
      const ver = p.verificado ? `<span class="badge">✅ Verificado</span>` : "";

      const el = document.createElement('div');
      el.className = "card pro-vert";
      el.innerHTML = `
        <img class="pro-photo" src="${foto}" alt="Foto de ${p.nome}">
        <div class="pro-name">${p.nome} ${ver}</div>
        <div class="pro-service">${serv}</div>
        <div class="pro-loc">${p.bairro || "-"} – ${p.cidade || "-"}</div>
        <div class="stars" aria-label="Nota ${rating.toFixed(1)}">${starBar(rating)} ${rating?`(${rating.toFixed(1)})`:""}</div>
        ${distTxt ? `<div class="distance">${distTxt}</div>` : `<div class="distance" style="visibility:hidden">.</div>`}
        <div class="pro-cta" style="width:100%"><a class="btn" href="/profissional/${p.id}">Ver perfil</a></div>
      `;
      frag.appendChild(el);
    });
    cards.appendChild(frag);
  }

  // ---------- Buscar ----------
  async function buscar(){
    const cidade = STATE.cidade || "";
    const bairro = inputBairro.value.trim();
    const servico = inputServico.value.trim();
    statusTxt.textContent = "Buscando…";

    const params = {
      cidade,
      bairro,
      servico,
      sort: (STATE.userLat!=null && STATE.userLng!=null) ? 'near' : 'rating',
      dir: (STATE.userLat!=null && STATE.userLng!=null) ? 'asc' : 'desc',
      page: 1,
      limit: 60
    };
    if (STATE.userLat!=null && STATE.userLng!=null){
      params.userLat = STATE.userLat;
      params.userLng = STATE.userLng;
    }

    try{
      const data = await fetchJSON('/api/profissionais?'+qs(params));
      render(data.items);
      statusTxt.textContent = `Encontrados: ${data.total}`;
      STATE.lastQuery = params;
    }catch(e){
      statusTxt.textContent = "Erro ao buscar";
      render([]);
    }
  }

  function limpar(){
    inputBairro.value = "";
    inputServico.value = "";
    statusTxt.textContent = "";
    cards.innerHTML = "";
    empty.style.display = "none";
  }

  // ---------- Eventos ----------
  btnBuscar.addEventListener('click', buscar);
  btnLimpar.addEventListener('click', limpar);

  changeCityBtn.addEventListener('click', ()=>{
    cidadeInput.value = STATE.cidade || "";
    openCityModal();
  });
  salvarCidade.addEventListener('click', async ()=>{
    const c = cidadeInput.value.trim();
    if (c){
      STATE.cidade = c;
      cityName.textContent = c;
      closeCityModal();
      await loadBairrosDaCidade();
      buscar();
    }
  });
  fecharCidade.addEventListener('click', closeCityModal);
  cityModal.addEventListener('click', (e)=>{ if(e.target===cityModal) closeCityModal(); });

  inputBairro.addEventListener('keydown', (e)=>{ if (e.key==='Enter') buscar(); });
  inputServico.addEventListener('keydown', (e)=>{ if (e.key==='Enter') buscar(); });

  // ---------- Boot ----------
  (async function init(){
    try{
      await loadCidades();
      await loadServicos();

      // Tenta detectar cidade pela geo (heurística)
      let guessed = await detectCidadeViaGeo();

      // Se não detectou, usa a primeira cidade com mais cadastros dentre as top 5 do /api/cidades
      if (!guessed && STATE.cidades.length){
        // Tenta casar key "Cidade/UF" -> só cidade
        const justCities = STATE.cidades.map(k=> k.includes('/') ? k : k).slice(0, 8);
        let best = null, bestCount = -1;
        for (const key of justCities){
          const cidadeParam = key; // backend lida insensível
          const data = await fetchJSON('/api/profissionais?'+qs({ cidade: cidadeParam, page:1, limit:1 }));
          if ((data.total||0) > bestCount){ bestCount = data.total; best = cidadeParam; }
        }
        guessed = best || STATE.cidades[0];
      }

      STATE.cidade = guessed || "";
      cityName.textContent = STATE.cidade || "Selecione a cidade";
      if (STATE.cidade) await loadBairrosDaCidade();

      // Busca inicial
      await buscar();
    }catch(e){
      cityName.textContent = "Selecione a cidade";
    }
  })();
})();
