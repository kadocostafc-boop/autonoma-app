// =========================================
//  CADASTRO PROFISSIONAL – FRONTEND
// =========================================

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("formCadastro");
  const btn = document.getElementById("btnCadastrar");
  const previewFoto = document.getElementById("previewFoto");

  // ===================== PREVIEW DA FOTO =====================
  const fotoInput = document.getElementById("foto");
  if (fotoInput) {
    fotoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        previewFoto.src = reader.result;
        previewFoto.style.display = "block";
      };
      reader.readAsDataURL(file);
    });
  }

  // ===================== SUBMIT DO FORMULÁRIO =====================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    btn.disabled = true;
    btn.innerText = "Enviando...";

    try {
      const formData = new FormData();

      // FOTO
      if (fotoInput.files.length > 0) {
        formData.append("foto", fotoInput.files[0]);
      }

      // CAMPOS DE TEXTO (EXATOS DO BACKEND)
      formData.append("nome", document.getElementById("nome").value.trim());
      formData.append("email", document.getElementById("email").value.trim());
      formData.append("whatsapp", document.getElementById("whatsapp").value.trim());
      formData.append("senha", document.getElementById("senha").value.trim());
      formData.append("cidade", document.getElementById("cidade").value.trim());
      formData.append("bairro", document.getElementById("bairro").value.trim());
      formData.append("estado", document.getElementById("estado").value.trim()); // 🔵 NOVO (UF obrigatório)
      formData.append("bio", document.getElementById("bio").value.trim());
      formData.append("servico", document.getElementById("servico").value.trim());

      // ===================== ENVIO PARA O BACKEND =====================
      const response = await fetch("/api/profissionais", {
        method: "POST",
        body: formData
      });

      const json = await response.json();

      if (!json.ok) {
        alert("Erro: " + json.error);
        btn.disabled = false;
        btn.innerText = "Cadastrar";
        return;
      }

      // SUCESSO
      window.location.href = json.redirect;

    } catch (err) {
      console.error("Erro ao enviar cadastro:", err);
      alert("Erro inesperado. Tente novamente.");
      btn.disabled = false;
      btn.innerText = "Cadastrar";
    }
  });

});