// WattTour viewer — orquestrador mínimo, plan-mode-first.
// Sem VirtualTourPlugin: a app é só "planta 2D -> foto 360". O viewer
// PSV core mostra um panorama; goTo() troca o panorama directamente.

(function main() {
  const Libs = window.WattTourLibs;
  if (!Libs) {
    alert("Bundle WattTour nao carregou. Confirma que assets/libs/watttour.js existe.");
    return;
  }
  const { Viewer, MarkersPlugin } = Libs;

  const data = window.TOUR_DATA;
  if (!data || !data.scenes?.length) {
    alert("Dados do tour nao carregaram.");
    return;
  }

  // -------- Topbar -----------------------------------------------------
  document.getElementById("tour-name").textContent = data.name || "";
  document.getElementById("tour-client").textContent = data.client || "";
  document.title = `${data.name || "Tour"} — WATTMIND 360`;
  if (data.branding?.logo) document.getElementById("logo").src = data.branding.logo;
  const splashName = document.getElementById("splash-name");
  if (splashName) splashName.textContent = data.name ? `${data.name} · WATTMIND 360` : "WATTMIND 360";

  // -------- Viewer -----------------------------------------------------
  const first = data.scenes[0];
  const viewer = new Viewer({
    container: document.getElementById("viewer"),
    panorama: first.panorama,
    defaultZoomLvl: 0,
    maxFov: 110,
    mousewheel: true,
    navbar: ["zoom", "move", "fullscreen"],
    plugins: [[MarkersPlugin, {}]],
  });
  const markersPlugin = viewer.getPlugin(MarkersPlugin);

  let currentId = first.id;
  let loading = false;

  // Força o zoom mais afastado sempre que uma cena carrega.
  function zoomOut() { try { viewer.zoom(0); } catch (e) { /* noop */ } }
  function sceneShown() {
    zoomOut();
    window.dispatchEvent(new CustomEvent("watttour:scene-shown", { detail: { id: currentId } }));
  }
  viewer.addEventListener("ready", sceneShown, { once: false });
  viewer.addEventListener("panorama-loaded", sceneShown);

  // -------- API para o plan-mode --------------------------------------
  window.WattTour = {
    viewer,
    markersPlugin,
    data,
    getCurrentId() { return currentId; },
    getCurrentScene() { return data.scenes.find((s) => s.id === currentId); },

    goTo(id) {
      const scene = data.scenes.find((s) => s.id === id);
      if (!scene || !scene.panorama) return;
      // Mostra o viewer, esconde a planta.
      document.getElementById("plan-mode").classList.add("hidden");
      document.getElementById("btn-back-to-plan")?.classList.remove("hidden");

      const pin = document.getElementById("active-pin");
      const pinName = document.getElementById("active-pin-name");
      if (pin && pinName) { pinName.textContent = scene.name || scene.id; pin.classList.remove("hidden"); }

      if (id === currentId && !loading) {
        // já está nesta cena — só garante zoom out
        try { viewer.zoom(0); } catch (e) { /* noop */ }
        return;
      }
      loading = true;
      currentId = id;
      viewer.setPanorama(scene.panorama, { transition: true, showLoader: true })
        .then(() => { try { viewer.zoom(0); } catch (e) {} })
        .catch((e) => console.warn("setPanorama falhou", e))
        .finally(() => { loading = false; });
    },

    backToPlan() {
      document.getElementById("plan-mode").classList.remove("hidden");
      document.getElementById("btn-back-to-plan")?.classList.add("hidden");
      document.getElementById("active-pin")?.classList.add("hidden");
      window.dispatchEvent(new CustomEvent("watttour:returned-to-plan"));
    },
  };

  // -------- Topbar / botões -------------------------------------------
  document.getElementById("btn-plan-mode")?.addEventListener("click", () => window.WattTour.backToPlan());
  document.getElementById("btn-fullscreen")?.addEventListener("click", () => viewer.toggleFullscreen());
  document.getElementById("btn-back-to-plan")?.addEventListener("click", () => window.WattTour.backToPlan());

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input,textarea")) return;
    const planVisible = !document.getElementById("plan-mode").classList.contains("hidden");
    if (!planVisible && (e.key === "Escape" || e.key.toLowerCase() === "p")) {
      window.WattTour.backToPlan();
    }
  });

  // -------- Splash -----------------------------------------------------
  const splash = document.getElementById("splash");
  if (splash) {
    setTimeout(() => splash.classList.add("fade"), 600);
    setTimeout(() => splash.remove(), 1400);
  }
})();
