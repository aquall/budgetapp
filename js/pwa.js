/** Installable-app support and iPhone Safari guidance. */
(function () {
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  window.BudgetAppPwa = { isStandalone };

  const installTip = document.getElementById("pwaInstallTip");
  if (installTip && isIos && !isStandalone) installTip.hidden = false;

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
        .catch(error => console.warn("Could not register the app's offline shell:", error));
    }, { once: true });
  }
})();
