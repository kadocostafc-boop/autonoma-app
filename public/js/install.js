// public/js/install.js
let deferredPrompt = null;
const btnInstall = document.querySelector("#btnInstall");
const installSection = document.querySelector("#installSection");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installSection) installSection.style.display = "";
});

if (btnInstall) {
  btnInstall.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice.outcome === "accepted") {
      // usuário aceitou instalar
      if (installSection) installSection.style.display = "none";
    }
  });
}

// iOS (Safari) não dispara beforeinstallprompt — mostramos dica
(function iosHint(){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const hint = document.querySelector("#iosHint");
  if (isIOS && !isStandalone && hint) {
    hint.style.display = "";
  }
})();

