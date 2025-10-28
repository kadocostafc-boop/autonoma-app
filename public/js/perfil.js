// public/js/perfil.js
(function(){
  // --- Utilidades ---
  const $ = s => document.querySelector(s);
  const esc = s => String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/\"/g,"&quot;")
    .replace(/'/g,"&#39;");
  const kmFmt = d => (d==null ? "—" : (d<1 ? `${(d*1000).toFixed(0)} m` : `${Number(d).toFixed(d<10?1:0)} km`));
  const stars = n => {
    const r=Math.round((Number(n)||0)*2)/2;
    const f=Math.floor(r),h=(r%1!==0);
    return "★".repeat(f)+(h?"½":"")+"☆".repeat(5-f-(h?1:0));
  };

  // Pega ID via ?id=123 ou via /profissional/123
  function getProfileId(){
    const url = new URL(location.href);
    const qid = url.searchParams.get('id');
    if (qid) return qid;
    const parts = location.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('profissional');
    if (i>=0 && parts[i+1]) return parts[i+1];
    return '';
  }
  const id = getProfileId();
  if(!id){ location.href = '/clientes.html'; return; }

  function flash(msg, ok=true){
    const box = $('#flash'); box.textContent = msg;
    box.className = 'card-soft msg ' + (ok?'ok':'warn'); box.style.display='';
    setTimeout(()=>{ box.style.display='none'; }, 2400);
  }

  async function getJSON(url){
    const r = await fetch(url,{cache:'no-store'});
    if(!r.ok) throw new Error('http '+r.status);
    return r.json();
  }

  // Tenta diferentes endpoints para o perfil
  async function loadProfile(pid){
    const tries = [
      `/api/profissional/${encodeURIComponent(pid)}`,
      `/api/profissionais?id=${encodeURIComponent(pid)}`,
      `/api/public/profissional?id=${encodeURIComponent(pid)}`
    ];
    for (const u of tries){
      try{
        const js = await getJSON(u);
        if(js){
          if(js.item) return js.item;
          if(js.id!=null || js.nome) return js;
        }
      }catch(_){}
    }
    // fallback
    try{
      const list = await getJSON('/api/profissionais');
      const arr = list.items || list.itens || list || [];
      const found = arr.find(x => String(x.id)===String(pid));
      if(found) return found;
    }catch(_){}
    throw new Error('notfound');
  }

  function computeExperience(p){
    if (p.experiencia && typeof p.experiencia === 'string') return p.experiencia;
    const n = Number(p.experienciaAnos ?? p.anosExp ?? p.exp ?? p.anos);
    if (!isNaN(n) && n>0) return n + (n>1 ? ' anos' : ' ano');
    const start = Number(p.inicioAno || p.anoInicio || p.desde);
    const now = new Date().getFullYear();
    if(!isNaN(start) && start>1900 && start<=now){
      const y = now - start;
      return y + (y!==1 ? ' anos' : ' ano');
    }
    return '—';
  }

  function haversineKm(lat1, lon1, lat2, lon2){
    const toRad = x => x * Math.PI/180;
    const R = 6371;
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  function tryClientDistance(p){
    if(!(p && typeof p.lat==='number' && typeof p.lng==='number')) return;
    if(!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((pos)=>{
      const km = haversineKm(pos.coords.latitude, pos.coords.longitude, p.lat, p.lng);
      $('#dist').textContent = kmFmt(km);
    }, ()=>{}, {enableHighAccuracy:true, timeout:10000, maximumAge:30000});
  }

  // Favoritos
  const KEY_FAVS = 'autonoma_favs';
  const getFavs = ()=>{ try{return JSON.parse(localStorage.getItem(KEY_FAVS)||'[]')}catch{return[]} };
  const setFavs = v => { try{localStorage.setItem(KEY_FAVS, JSON.stringify(v||[]))}catch{} };
  const isFav = pid => getFavs().some(x => String(x.id)===String(pid));
  function upsertFav(obj){
    const arr = getFavs();
    const i = arr.findIndex(x => String(x.id)===String(obj.id));
    if (i>=0) arr[i] = {...arr[i], ...obj}; else arr.push(obj);
    setFavs(arr);
  }
  function removeFav(pid){
    const arr = getFavs().filter(x => String(x.id)!==String(pid));
    setFavs(arr);
  }

  let PROF=null;
  async function init(){
    try{
      PROF = await loadProfile(id);
      $('#foto').src = PROF.foto || '/icons/icon-192.png';
      $('#foto').alt = 'Foto de ' + (PROF.nome || 'Profissional');
      $('#nome').textContent = PROF.nome || 'Profissional';
      $('#servLocal').textContent = [PROF.servico || PROF.profissao, [PROF.bairro, PROF.cidade].filter(Boolean).join(' • ')].filter(Boolean).join(' • ') || '—';
      $('#k_trab').textContent = Number(PROF.trabalhos||PROF.atendimentos||0);
      $('#k_exp').textContent  = computeExperience(PROF);
      $('#k_calls').textContent= Number(PROF.chamadas||0);
      $('#k_vis').textContent  = Number(PROF.visitas||0);
      $('#precoBase').textContent = PROF.precoBase ? String(PROF.precoBase) : '—';
      if(PROF.site){
        $('#site').textContent=PROF.site; $('#site').href=PROF.site;
      } else {
        $('#site').textContent='—'; $('#site').removeAttribute('href');
      }
      $('#dist').textContent = kmFmt(PROF.distanceKm);
      if (PROF.distanceKm == null) tryClientDistance(PROF);

      // Avaliação média
      const ratingNum = Number(PROF.rating||0);
      $('#stars').textContent = stars(ratingNum);
      const avalCount = Array.isArray(PROF.avaliacoes) ? PROF.avaliacoes.length : Number(PROF.avaliacoes||0);
      $('#count').textContent = `(${isNaN(avalCount)?0:avalCount})`;

      $('#desc').textContent = PROF.descricao || '—';

      // WhatsApp com frase pronta
      if(PROF.whatsapp){
        const d = String(PROF.whatsapp).replace(/\D/g,'');
        const num = d.startsWith('55') ? d : ('55'+d);
        const texto = encodeURIComponent("Olá, vi seu perfil na Nomma e gostaria de contratar seu serviço.");
        $('#btnWa').href = 'https://wa.me/' + num + '?text=' + texto;
      } else {
        $('#btnWa').classList.add('outline');
        $('#btnWa').textContent = 'WhatsApp indisponível';
        $('#btnWa').removeAttribute('href');
      }

      // Estado do botão Favoritar
      if (isFav(id)) $('#btnFav').classList.add('on');

      // Avaliações detalhadas
      const avals = Array.isArray(PROF.avaliacoesDetalhe)? PROF.avaliacoesDetalhe : [];
      if(avals.length){
        $('#reviews').innerHTML = avals.slice(0,10).map(a=>`
          <div class="item">
            <div class="row" style="justify-content:space-between">
              <strong>${esc(a.autor||'Cliente')}</strong>
              <span class="rating">${stars(a.nota||0)}</span>
            </div>
            <p class="meta" style="margin:6px 0 0">${esc(a.texto||'')}</p>
          </div>
        `).join('');
        $('#noReviews').style.display='none';
      } else {
        $('#reviews').innerHTML = '';
        $('#noReviews').style.display='';
      }

      // Botão avaliar -> link para /avaliar/:id
      $('#btnAval').addEventListener('click', ()=>{
        location.href = '/avaliar/' + encodeURIComponent(id);
      });

    }catch(e){
      flash('Não foi possível carregar o perfil.', false);
    }
  }

  // Ações
  $('#btnFav').addEventListener('click', ()=>{
    const on = isFav(id);
    if (on){
      removeFav(id);
      $('#btnFav').classList.remove('on');
      $('#msgActions').textContent = 'Removido dos favoritos.';
      $('#msgActions').className = 'msg ok';
    } else {
      const obj = {
        id: PROF?.id || id,
        nome: PROF?.nome || 'Profissional',
        servico: PROF?.servico || PROF?.profissao || '',
        bairro: PROF?.bairro || '',
        cidade: PROF?.cidade || '',
        local: [PROF?.bairro, PROF?.cidade].filter(Boolean).join(' • '),
        whatsapp: PROF?.whatsapp || '',
        foto: PROF?.foto || '',
        rating: Number(PROF?.rating||0),
        atendimentos: Number(PROF?.atendimentos||0),
        distanceKm: (typeof PROF?.distanceKm==='number') ? PROF.distanceKm : null
      };
      upsertFav(obj);
      $('#btnFav').classList.add('on');
      $('#msgActions').textContent = 'Adicionado aos favoritos.';
      $('#msgActions').className = 'msg ok';
    }
  });

  $('#btnRec').addEventListener('click', async ()=>{
    $('#btnRec').classList.add('on');
    $('#msgActions').textContent = 'Obrigado! Recomendação registrada.';
    $('#msgActions').className = 'msg ok';
    try{
      await fetch('/api/recomendacoes',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id})
      });
    }catch(_){}
  });

  init();
})();