// WattTour — mini-mapa no viewer 360.
// Mini-planta no canto, com todos os pontos. Click num ponto → salta.
// Colapsável para não estorvar a vista 360.

(function () {
  "use strict";

  let built = false;
  let collapsed = false;

  function init() {
    const tour = window.WattTour;
    if (!tour) { setTimeout(init, 150); return; }
    build();
    window.addEventListener("watttour:scene-shown", () => { show(); refresh(); });
    window.addEventListener("watttour:returned-to-plan", hide);
    hide();   // arranca escondido (landing é a planta)
  }

  function floorsWithPlan() {
    return (window.WattTour?.data.floors || []).filter((f) => f.plan);
  }
  // Piso da cena actual (fallback: primeiro piso com planta).
  function sceneFloor() {
    const tour = window.WattTour;
    const cur = (tour?.data.scenes || []).find((s) => s.id === tour.getCurrentId());
    const floors = floorsWithPlan();
    return floors.find((f) => f.id === cur?.floor) || floors[0] || null;
  }

  function build() {
    if (built) return;
    if (!floorsWithPlan().length) return;
    built = true;
    const el = document.createElement("div");
    el.id = "mini-map";
    el.innerHTML = `
      <div class="mm-head">
        <span class="mm-title">Planta</span>
        <button class="mm-collapse" title="Recolher / abrir">▾</button>
      </div>
      <div class="mm-body">
        <img class="mm-img" alt="planta" draggable="false" />
        <svg class="mm-pins" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>`;
    document.body.appendChild(el);
    el.querySelector(".mm-collapse").addEventListener("click", toggleCollapse);
    el.querySelector(".mm-title").addEventListener("click", toggleCollapse);
    el.querySelector(".mm-img").onload = () => refresh();
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    document.getElementById("mini-map")?.classList.toggle("collapsed", collapsed);
  }
  function show() { document.getElementById("mini-map")?.classList.remove("hidden"); }
  function hide() { document.getElementById("mini-map")?.classList.add("hidden"); }

  function refresh() {
    const tour = window.WattTour;
    const el = document.getElementById("mini-map");
    if (!tour || !el) return;
    const floor = sceneFloor();
    if (!floor) return;
    const img = el.querySelector(".mm-img");
    const svg = el.querySelector(".mm-pins");
    // Mudou de piso → trocar a planta; o onload volta a chamar refresh().
    if (el.dataset.floorId !== String(floor.id)) {
      el.dataset.floorId = String(floor.id);
      el.querySelector(".mm-title").textContent =
        floorsWithPlan().length > 1 ? `Planta · ${floor.name || floor.id}` : "Planta";
      img.src = floor.plan;
      if (!(img.complete && img.naturalWidth)) return;
    }
    if (!img.naturalWidth) return;
    const W = img.naturalWidth, H = img.naturalHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const current = tour.getCurrentId();
    let out = "";
    for (const s of tour.data.scenes) {
      if (s.floor !== floor.id || s.plan_x == null || s.plan_y == null) continue;
      const cx = s.plan_x * W, cy = s.plan_y * H;
      const cur = s.id === current;
      const r = cur ? W * 0.014 : W * 0.009;
      out += `<g class="mm-pin" data-id="${s.id}">
        <circle cx="${cx}" cy="${cy}" r="${r * 2.2}" fill="${cur ? '#F5A524' : '#4C8DFF'}" opacity="0.25"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${cur ? '#F5A524' : '#4C8DFF'}"
                stroke="#fff" stroke-width="${W * 0.0035}"/>
      </g>`;
    }
    svg.innerHTML = out;
    svg.querySelectorAll(".mm-pin").forEach((g) => {
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = g.dataset.id;
        if (id) tour.goTo(id);
      });
    });
  }

  init();
})();
