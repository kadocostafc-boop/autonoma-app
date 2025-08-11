// Helpers
const $ = (s) => document.querySelector(s);

document.addEventListener("DOMContentLoaded", () => {
  // preview da foto
  const inputFoto = $("#foto");
  const img = $("#previewImg");
  const fallback = $("#previewFallback");

  if (inputFoto) {
    inputFoto.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        img.style.display = "none";
        fallback.style.display = "inline";
        img.removeAttribute("src");
        return;
      }
      // validação simples
      if (!file.type.startsWith("image/")) {
        alert("Envie um arquivo de imagem (JPG/PNG).");
        e.target.value = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) { // 2MB
        alert("Imagem muito grande. Tamanho máximo: 2MB.");
        e.target.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      img.src = url;
      img.style.display = "block";
      fallback.style.display = "none";
    });
  }

  // máscara/normalização simples de telefone/whatsapp
  const tel = $("#telefone");
  const wa = $("#whatsapp");

  const maskPhone = (value) => {
    // mantém somente dígitos e aplica formato (DD) 00000-0000
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 10) {
      return d.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    }
    return d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
  };

  const onMask = (el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      el.value = maskPhone(el.value);
      // cursor ao fim em navegadores modernos
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  onMask(tel);
  onMask(wa);

  // antes de enviar: normaliza números para dígitos e garante +55 se faltar
  const form = document.getElementById("formCadastro");
  if (form) {
    form.addEventListener("submit", () => {
      const onlyDigits = (v) => (v || "").replace(/\D/g, "");
      const ensureBR = (v) => {
        if (!v) return v;
        // se vier com 10/11 dígitos, assume BR e prefixa 55
        if (/^\d{10,11}$/.test(v)) return "55" + v;
        return v; // já pode estar com 55
      };

      const telDigits = ensureBR(onlyDigits(tel?.value));
      const waDigits = ensureBR(onlyDigits(wa?.value));

      if (tel) tel.value = telDigits || "";
      if (wa) wa.value = waDigits || "";
      // deixa o submit seguir normalmente (enctype multipart -> /cadastrar)
    });
  }
});
