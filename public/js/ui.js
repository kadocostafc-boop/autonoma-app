<script>
/* ui.js — helpers simples */
window.UI = (function(){
  function toast(msg, type='ok', ms=2200){
    try{
      const el = document.createElement('div');
      el.className = 'toast ' + (type==='err'?'err':type==='warn'?'warn':'ok');
      el.setAttribute('role','status');
      el.setAttribute('aria-live','polite');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(()=> el.remove(), ms);
    }catch{}
  }
  function netBannerMount(){
    const id='net-banner';
    let bar = document.getElementById(id);
    if(!bar){
      bar = document.createElement('div');
      bar.id=id; bar.className='net-banner'; bar.style.display='none';
      document.body.prepend(bar);
    }
    function show(on){
      if(on===true){
        bar.textContent = 'Conectado – as buscas e cadastros estão ativos.';
        bar.className='net-banner net-on';
        bar.style.display='';
        setTimeout(()=>{bar.style.display='none'},1200);
      }else{
        bar.textContent = 'Você está offline – alguns recursos podem não funcionar.';
        bar.className='net-banner net-off';
        bar.style.display='';
      }
    }
    window.addEventListener('online', ()=> show(true));
    window.addEventListener('offline', ()=> show(false));
    // estado inicial
    if (!navigator.onLine) show(false);
  }
  return { toast, netBannerMount };
})();
</script>