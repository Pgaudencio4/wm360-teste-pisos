// WattTour — Modo Planta 2D.
// Planta com pan/zoom; pinos de tamanho constante no ecrã (contra-escala
// ao zoom); modo edição para arrastar/relocalizar pontos; exportação.
//
// Edição: botão "Editar", tecla E, ou abrir com ?edit=1 / #edit.
// As posições editadas guardam-se em localStorage e podem ser exportadas
// como tour-data.js para substituir no projecto.

(function () {
  "use strict";

  const PIN_SCREEN_PX = 22;          // diâmetro alvo do pino no ecrã
  const STORE_KEY = "watttour:positions";
  const VISITED_KEY = "watttour:visited";
  const ANNOT_KEY = "watttour:annotations";
  let visited = loadVisited();

  let wired = false;
  let editing = false;
  let dirty = false;
  let currentFloorId = null;         // piso visivel na planta
  // Edição só disponível com ?edit=1 / #edit no URL. Versão para cliente
  // (URL normal) não mostra o botão nem permite editar.
  let editAllowed = false;
  const st = {
    scale: 1, minScale: 0.05, maxScale: 12,
    tx: 0, ty: 0,
    natW: 0, natH: 0,
    dragView: false, lastX: 0, lastY: 0,
    dragPin: null,                   // {sceneId, startX, startY}
  };

  // ---------------------------------------------------------------- init
  function init() {
    const tour = window.WattTour;
    if (!tour) { setTimeout(init, 150); return; }
    if (wired) return;
    wired = true;

    restorePositions(tour);
    restoreAnnotations(tour);

    editAllowed = /[?#].*\bedit\b/.test(location.search + location.hash);
    const editBtn = document.getElementById("btn-edit-toggle");
    if (editBtn) {
      editBtn.style.display = editAllowed ? "" : "none";
      editBtn.addEventListener("click", toggleEdit);
    }
    document.getElementById("plan-search")?.addEventListener("input", onSearch);

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input,textarea")) return;
      if (!isOpen()) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") zoomBy(0.8);
      else if (e.key === "0") fit();
      else if (editAllowed && e.key.toLowerCase() === "e") toggleEdit();
      else if (e.key === "Escape" && editing) toggleEdit();
    });

    window.addEventListener("watttour:returned-to-plan", () => {
      // Abrir a planta no piso da cena onde o utilizador estava.
      const before = currentFloorId;
      syncFloorToScene();
      if (currentFloorId !== before) {
        renderFloorTabs();
        loadImage(currentFloor());
      } else {
        renderPins();
      }
      renderSidebar();
    });
    window.addEventListener("resize", () => { if (isOpen()) fit(); });

    open();
  }

  function isOpen() { return !document.getElementById("plan-mode")?.classList.contains("hidden"); }

  function open() {
    const tour = window.WattTour;
    if (!floorsWithPlan().length) { alert("Tour sem planta."); return; }
    syncFloorToScene();
    document.getElementById("plan-mode").classList.remove("hidden");
    document.getElementById("plan-mode-name").textContent = tour.data.name || "";
    buildStage();
    renderFloorTabs();
    loadImage(currentFloor());
    renderSidebar();
  }
  function close() { document.getElementById("plan-mode")?.classList.add("hidden"); }

  function floorsWithPlan() {
    return (window.WattTour?.data.floors || []).filter((f) => f.plan);
  }
  function currentFloor() {
    const fs = floorsWithPlan();
    return fs.find((f) => f.id === currentFloorId) || fs[0] || null;
  }
  // Alinha o piso visivel com o da cena actual (se essa planta existir).
  function syncFloorToScene() {
    const tour = window.WattTour;
    const cur = (tour?.data.scenes || []).find((s) => s.id === tour.getCurrentId());
    if (cur && floorsWithPlan().some((f) => f.id === cur.floor)) currentFloorId = cur.floor;
    if (!floorsWithPlan().some((f) => f.id === currentFloorId)) {
      currentFloorId = floorsWithPlan()[0]?.id ?? null;
    }
  }
  function planScenes() {
    const f = currentFloor();
    return (window.WattTour?.data.scenes || []).filter(
      (s) => s.floor === f?.id && s.plan_x != null && s.plan_y != null);
  }
  function scenesOfFloor(id) {
    return (window.WattTour?.data.scenes || []).filter(
      (s) => s.floor === id && s.plan_x != null && s.plan_y != null);
  }

  // ------------------------------------------------------ pisos (tabs)
  function renderFloorTabs() {
    const el = document.getElementById("plan-floors");
    if (!el) return;
    const floors = floorsWithPlan();
    el.textContent = "";
    if (floors.length < 2) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    for (const f of floors) {
      const b = document.createElement("button");
      b.className = "floor-tab" + (f.id === currentFloorId ? " active" : "");
      b.appendChild(document.createTextNode(f.name || f.id));
      const n = document.createElement("span");
      n.className = "ft-count";
      n.textContent = String(scenesOfFloor(f.id).length);
      b.appendChild(n);
      b.addEventListener("click", () => switchFloor(f.id));
      el.appendChild(b);
    }
  }
  function switchFloor(id) {
    if (id === currentFloorId) return;
    currentFloorId = id;
    cancelDraft();
    hidePreview();
    const q = document.getElementById("plan-search");
    if (q && q.value) { q.value = ""; onSearch({ target: q }); }
    renderFloorTabs();
    loadImage(currentFloor());
    renderSidebar();
  }

  // ------------------------------------------------------------- stage
  function buildStage() {
    const stage = document.getElementById("plan-mode-stage");
    if (!stage || stage.dataset.built === "1") return;
    stage.dataset.built = "1";
    stage.innerHTML = `
      <div class="plan-viewport">
        <div class="plan-canvas">
          <img id="plan-mode-img" alt="planta" draggable="false" />
          <svg id="plan-mode-annot" xmlns="http://www.w3.org/2000/svg"></svg>
          <svg id="plan-mode-pins" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </div>
      <div class="plan-controls">
        <button class="zoom-btn" data-z="in"  title="Zoom + (+)">+</button>
        <button class="zoom-btn" data-z="out" title="Zoom - (-)">−</button>
        <button class="zoom-btn" data-z="fit" title="Ajustar (0)">⛶</button>
      </div>
      <div class="plan-edit-banner hidden" id="plan-edit-banner">
        <div class="edit-tools">
          <button class="tool" data-tool="move" title="Mover pontos">✥</button>
          <button class="tool" data-tool="wall" title="Parede / linha">╱</button>
          <button class="tool" data-tool="rect" title="Caixa">▭</button>
          <button class="tool" data-tool="arrow" title="Seta">➤</button>
          <button class="tool" data-tool="text" title="Texto">T</button>
          <button class="tool" data-tool="erase" title="Apagar">⌫</button>
          <span class="tool-sep"></span>
          <button class="swatch" data-color="#1A1A1A" style="background:#1A1A1A"></button>
          <button class="swatch" data-color="#E8442C" style="background:#E8442C"></button>
          <button class="swatch" data-color="#4C8DFF" style="background:#4C8DFF"></button>
          <button class="swatch" data-color="#F5A524" style="background:#F5A524"></button>
        </div>
        <span class="edit-msg" id="edit-msg">Modo edicao</span>
        <div class="edit-acts">
          <button id="edit-save">Guardar</button>
          <button id="edit-export">Exportar ZIP cliente</button>
          <button id="edit-reset">Repor</button>
          <button id="edit-done">Concluir</button>
        </div>
      </div>
    `;
    stage.querySelectorAll(".zoom-btn").forEach((b) => b.addEventListener("click", () => {
      const z = b.dataset.z;
      if (z === "in") zoomBy(1.3); else if (z === "out") zoomBy(0.77); else fit();
    }));
    stage.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
    stage.querySelectorAll(".swatch").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color)));
    document.getElementById("edit-save").addEventListener("click", () => { savePositions(); saveAnnotations(); flashBanner("Guardado no browser."); });
    document.getElementById("edit-export").addEventListener("click", exportData);
    document.getElementById("edit-reset").addEventListener("click", resetPositions);
    document.getElementById("edit-done").addEventListener("click", toggleEdit);
    setTool("move"); setColor("#E8442C");
    wireViewport(stage.querySelector(".plan-viewport"));
  }

  function loadImage(floor) {
    const img = document.getElementById("plan-mode-img");
    img.onload = () => {
      st.natW = img.naturalWidth; st.natH = img.naturalHeight;
      for (const id of ["plan-mode-pins", "plan-mode-annot"]) {
        const svg = document.getElementById(id);
        svg.setAttribute("width", st.natW); svg.setAttribute("height", st.natH);
        svg.setAttribute("viewBox", `0 0 ${st.natW} ${st.natH}`);
      }
      renderAnnotations(); renderPins(); fit();
    };
    img.src = floor.plan;
    if (img.complete && img.naturalWidth) img.onload();
  }

  // -------------------------------------------------------------- pins
  function renderPins() {
    const svg = document.getElementById("plan-mode-pins");
    if (!svg || !st.natW) return;
    const tour = window.WattTour;
    const current = tour.getCurrentId();
    // <defs> com sombra, partilhado.
    svg.innerHTML = `<defs>
      <filter id="pin-shadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/>
      </filter></defs>`;
    for (const s of planScenes()) {
      const cx = s.plan_x * st.natW, cy = s.plan_y * st.natH;
      const isCur = s.id === current;
      const isVis = !!visited[s.id];
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "plan-pin"
        + (isCur ? " is-current" : "") + (isVis ? " is-visited" : ""));
      g.dataset.sceneId = s.id;
      g.dataset.cx = cx; g.dataset.cy = cy;
      g.innerHTML = pinSvg(isCur, isVis);
      g.addEventListener("mousedown", (e) => onPinDown(e, s, g));
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!editing && !pinMoved) teleport(s.id);
      });
      g.addEventListener("mouseenter", (e) => {
        sidebarHover(s.id, true);
        g.classList.add("hover"); applyPinScale();
        if (!editing) showPreview(s, e);
      });
      g.addEventListener("mousemove", movePreview);
      g.addEventListener("mouseleave", () => {
        sidebarHover(s.id, false);
        g.classList.remove("hover"); applyPinScale();
        hidePreview();
      });
      svg.appendChild(g);
    }
    applyPinScale();
  }

  // Pino = dot circular limpo. Camadas (do consenso dos agentes):
  //   halo branco 3-4px (legibilidade sobre planta CAD) + preenchimento
  //   saturado + ponto central branco + sombra. Sem rótulo (nome em hover).
  // Base desenhada num círculo de raio 22; contra-escalada para tamanho
  // de ecrã constante.
  function pinSvg(isCur, isVis) {
    const fill = isCur ? "#F5A524" : (isVis ? "#7C8597" : "#4C8DFF");
    const halo = isCur
      ? `<circle r="20" fill="#F5A524" opacity="0.22"><animate attributeName="r"
           values="14;22;14" dur="2s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite"/></circle>`
      : "";
    return `
      ${halo}
      <g filter="url(#pin-shadow)">
        <circle r="11" fill="#fff"/>
        <circle r="8.5" fill="${fill}"/>
        <circle r="3" fill="#fff"/>
      </g>`;
  }

  function applyPinScale() {
    // Contra-escala: pino fica ~PIN_SCREEN_PX no ecrã independente do zoom.
    // Base do dot: raio externo 11 -> diâmetro 22.
    const k = (PIN_SCREEN_PX / 22) / st.scale;
    document.querySelectorAll("#plan-mode-pins .plan-pin").forEach((g) => {
      const hov = g.classList.contains("hover") ? 1.28 : 1;
      g.setAttribute("transform", `translate(${g.dataset.cx},${g.dataset.cy}) scale(${k * hov})`);
    });
  }

  function loadVisited() {
    try { return JSON.parse(localStorage.getItem(VISITED_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  // ----------------------------------------------------------- sidebar
  function renderSidebar() {
    const ul = document.getElementById("plan-side-list");
    if (!ul) return;
    const tour = window.WattTour;
    const current = tour.getCurrentId();
    const scenes = planScenes().slice().sort(
      (a, b) => (a.name || a.id).localeCompare(b.name || b.id, "pt", { numeric: true }));
    ul.innerHTML = "";
    for (const s of scenes) {
      const li = document.createElement("li");
      li.className = "plan-side-item" + (s.id === current ? " active" : "");
      li.dataset.sceneId = s.id;
      const thumbSrc = s.thumbnail || s.panorama || "";
      li.innerHTML = `
        <span class="psi-thumb" style="background-image:url('${thumbSrc}')"></span>
        <span class="psi-name">${escapeXml(s.name || s.id)}</span>`;
      li.addEventListener("click", () => teleport(s.id));
      li.addEventListener("mouseenter", () => pinGlow(s.id, true));
      li.addEventListener("mouseleave", () => pinGlow(s.id, false));
      ul.appendChild(li);
    }
    const label = `${scenes.length} ponto${scenes.length === 1 ? "" : "s"}`;
    document.getElementById("plan-side-count").textContent = label;
    document.getElementById("plan-mode-sub").textContent = label;
  }

  function onSearch(e) {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".plan-side-item").forEach((li) => {
      li.style.display = !q || li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  }
  function sidebarHover(id, on) {
    document.querySelectorAll(`.plan-side-item[data-scene-id="${id}"]`).forEach((el) => {
      el.classList.toggle("hover", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }
  function pinGlow(id, on) {
    document.querySelectorAll(`#plan-mode-pins .plan-pin[data-scene-id="${id}"]`).forEach((g) => {
      g.classList.toggle("hover", on);
    });
    applyPinScale();
  }

  function teleport(id) {
    visited[id] = true;
    try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) { /* noop */ }
    const tour = window.WattTour;
    if (tour) tour.goTo(id); else close();
  }

  // -------------------------------------------------------- pan / zoom
  function applyTransform() {
    const c = document.querySelector("#plan-mode-stage .plan-canvas");
    if (c) c.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.scale})`;
    applyPinScale();
  }
  function zoomBy(f, cx, cy) {
    const vp = document.querySelector("#plan-mode-stage .plan-viewport");
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const x = (cx ?? r.left + r.width / 2) - r.left;
    const y = (cy ?? r.top + r.height / 2) - r.top;
    const ns = Math.max(st.minScale, Math.min(st.maxScale, st.scale * f));
    const k = ns / st.scale;
    st.tx = x - k * (x - st.tx);
    st.ty = y - k * (y - st.ty);
    st.scale = ns;
    applyTransform();
  }
  function fit() {
    const vp = document.querySelector("#plan-mode-stage .plan-viewport");
    if (!vp || !st.natW) return;
    const pad = 56;
    st.scale = Math.min((vp.clientWidth - pad) / st.natW, (vp.clientHeight - pad) / st.natH);
    st.minScale = st.scale * 0.4;
    st.tx = (vp.clientWidth - st.natW * st.scale) / 2;
    st.ty = (vp.clientHeight - st.natH * st.scale) / 2;
    applyTransform();
  }
  function wireViewport(vp) {
    vp.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 0.87, e.clientX, e.clientY);
    }, { passive: false });
    vp.addEventListener("mousedown", (e) => {
      if (e.target.closest("g.plan-pin")) return;
      // Modo edição com ferramenta de desenho activa → desenhar.
      if (editing && tool !== "move") { drawDown(e); return; }
      st.dragView = true; st.lastX = e.clientX; st.lastY = e.clientY;
      vp.classList.add("dragging");
    });
    window.addEventListener("mousemove", (e) => {
      if (drawing) { drawMove(e); return; }
      if (st.dragPin) { dragPinMove(e); return; }
      if (!st.dragView) return;
      st.tx += e.clientX - st.lastX; st.ty += e.clientY - st.lastY;
      st.lastX = e.clientX; st.lastY = e.clientY;
      applyTransform();
    });
    window.addEventListener("mouseup", (e) => {
      if (drawing) { drawUp(e); }
      st.dragView = false; vp.classList.remove("dragging");
      if (st.dragPin) dragPinEnd();
    });
    vp.addEventListener("dblclick", () => { if (drawing && tool === "wall") finishWall(); });
    // pinch
    let pd = 0;
    vp.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) pd = tDist(e.touches);
      else if (e.touches.length === 1) {
        st.dragView = true; st.lastX = e.touches[0].clientX; st.lastY = e.touches[0].clientY;
      }
    });
    vp.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const d = tDist(e.touches);
        zoomBy(d / pd, (e.touches[0].clientX + e.touches[1].clientX) / 2,
                       (e.touches[0].clientY + e.touches[1].clientY) / 2);
        pd = d;
      } else if (st.dragView && e.touches.length === 1) {
        const t = e.touches[0];
        st.tx += t.clientX - st.lastX; st.ty += t.clientY - st.lastY;
        st.lastX = t.clientX; st.lastY = t.clientY;
        applyTransform();
      }
    }, { passive: false });
    vp.addEventListener("touchend", () => { st.dragView = false; });
  }
  function tDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

  // ------------------------------------------------------- edit mode
  let pinMoved = false;

  function toggleEdit() {
    if (!editAllowed) return;
    editing = !editing;
    document.getElementById("plan-edit-banner")?.classList.toggle("hidden", !editing);
    document.getElementById("btn-edit-toggle")?.classList.toggle("btn--primary", editing);
    document.querySelector("#plan-mode-stage .plan-viewport")?.classList.toggle("editing", editing);
    if (!editing) { cancelDraft(); setTool("move"); }
    hidePreview();
  }

  function onPinDown(e, scene, g) {
    if (!editing) return;
    e.stopPropagation(); e.preventDefault();
    pinMoved = false;
    st.dragPin = { sceneId: scene.id, scene, g, startX: e.clientX, startY: e.clientY };
  }
  function dragPinMove(e) {
    const dp = st.dragPin; if (!dp) return;
    const dx = (e.clientX - dp.startX) / st.scale;
    const dy = (e.clientY - dp.startY) / st.scale;
    if (Math.abs(e.clientX - dp.startX) > 3 || Math.abs(e.clientY - dp.startY) > 3) pinMoved = true;
    let nx = (dp.scene.plan_x * st.natW + dx) / st.natW;
    let ny = (dp.scene.plan_y * st.natH + dy) / st.natH;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    dp.scene._dragX = nx; dp.scene._dragY = ny;
    const cx = nx * st.natW, cy = ny * st.natH;
    const k = (PIN_SCREEN_PX / 40) / st.scale;
    dp.g.setAttribute("transform", `translate(${cx},${cy}) scale(${k})`);
    dp.g.dataset.cx = cx; dp.g.dataset.cy = cy;
  }
  function dragPinEnd() {
    const dp = st.dragPin; st.dragPin = null;
    if (!dp) return;
    if (dp.scene._dragX != null) {
      dp.scene.plan_x = dp.scene._dragX;
      dp.scene.plan_y = dp.scene._dragY;
      delete dp.scene._dragX; delete dp.scene._dragY;
      dirty = true;
      savePositions();   // autosave
    }
    setTimeout(() => { pinMoved = false; }, 50);
  }

  // --------------------------------------------------- persist/export
  function savePositions() {
    // Todas as cenas com coordenadas, de todos os pisos: gravar só o piso
    // visivel apagaria as edicoes feitas nos outros.
    const out = {};
    for (const s of (window.WattTour?.data.scenes || [])) {
      if (s.plan_x != null && s.plan_y != null) out[s.id] = { x: s.plan_x, y: s.plan_y };
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (e) { /* noop */ }
    dirty = false;
  }
  function restorePositions(tour) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      for (const s of tour.data.scenes) {
        if (pos[s.id]) { s.plan_x = pos[s.id].x; s.plan_y = pos[s.id].y; }
      }
    } catch (e) { /* noop */ }
  }
  function resetPositions() {
    if (!confirm("Repor as posicoes originais? Perde as alteracoes guardadas no browser.")) return;
    localStorage.removeItem(STORE_KEY);
    location.reload();
  }
  // Exporta a VERSÃO CLIENTE completa num único ZIP, pronto a entregar.
  // Empacota HTML/JS/CSS + panoramas + miniaturas + planta + tour-data.js
  // (já com as edições). O cliente descomprime e abre o index.html.
  async function exportData() {
    const tour = window.WattTour;
    const JSZip = window.WattTourLibs && window.WattTourLibs.JSZip;
    if (!JSZip) { alert("Biblioteca ZIP indisponivel."); return; }

    if (location.protocol === "file:") {
      alert("Para exportar o ZIP, abre o tour pelo Abrir-Tour.bat (servidor local).\n"
        + "Em file:// o browser bloqueia a leitura dos ficheiros.");
      return;
    }

    const zip = new JSZip();
    // tour-data.js fresco com as edições.
    zip.file("tour-data.js", "window.TOUR_DATA = " + JSON.stringify(tour.data) + ";\n");

    // Lista de ficheiros a incluir.
    const staticFiles = [
      "index.html", "tour.js", "tour.css", "tour.planmode.js", "tour.minimap.js",
      "assets/libs/watttour.js", "assets/libs/watttour.css", "assets/wattmind-logo.png",
      "Abrir-Tour.bat", "Abrir-Tour.ps1", "Como abrir.txt",
    ];
    const media = new Set();
    for (const s of tour.data.scenes) {
      if (s.panorama) media.add(s.panorama);
      if (s.thumbnail) media.add(s.thumbnail);
    }
    for (const f of tour.data.floors || []) if (f.plan) media.add(f.plan);
    const all = staticFiles.concat([...media]);

    let done = 0;
    for (const path of all) {
      try {
        const r = await fetch(path);
        if (r.ok) zip.file(path, await r.blob());
        else console.warn("ZIP: falta", path);
      } catch (e) { console.warn("ZIP: falha", path, e); }
      done++;
      flashBanner(`A empacotar... ${done}/${all.length}`);
    }

    flashBanner("A comprimir o ZIP (pode demorar)...");
    try {
      const out = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (meta) => { if (meta.percent) flashBanner(`A comprimir... ${meta.percent.toFixed(0)}%`); }
      );
      const safe = (tour.data.name || "tour").replace(/[^a-zA-Z0-9]+/g, "_");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out);
      a.download = `${safe}_cliente.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      flashBanner("ZIP do cliente pronto — descarregado.");
    } catch (e) {
      console.error(e);
      alert("Falha a gerar o ZIP: " + (e && e.message));
    }
  }
  function flashBanner(msg) {
    const span = document.getElementById("edit-msg");
    if (!span) return;
    const old = span.dataset.base || span.textContent;
    span.dataset.base = old;
    span.textContent = msg;
    setTimeout(() => { span.textContent = span.dataset.base || old; }, 3000);
  }

  // ===================================================================
  // FERRAMENTAS DE DESENHO (paredes, caixas, setas, texto)
  // ===================================================================
  let tool = "move";
  let drawColor = "#E8442C";
  let drawing = false;
  let draft = null;

  function annots() {
    const d = window.WattTour.data;
    if (!Array.isArray(d.annotations)) d.annotations = [];
    return d.annotations;
  }
  // Anotacoes do piso visivel. As antigas, sem campo floor, pertencem ao
  // primeiro piso (compatibilidade com tours existentes).
  function isOnCurrentFloor(a) {
    const first = floorsWithPlan()[0]?.id;
    return (a.floor ?? first) === currentFloor()?.id;
  }
  function setTool(t) {
    tool = t;
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    const vp = document.querySelector("#plan-mode-stage .plan-viewport");
    if (vp) vp.classList.toggle("drawing", editing && t !== "move");
    if (drawing && t !== "wall") cancelDraft();
    const msg = document.getElementById("edit-msg");
    if (msg) {
      const labels = { move: "Mover pontos", wall: "Parede: clica vertices, duplo-clique termina",
        rect: "Caixa: arrasta", arrow: "Seta: arrasta", text: "Texto: clica para colocar",
        erase: "Apagar: clica numa anotacao" };
      msg.textContent = labels[t] || "Modo edicao";
      msg.dataset.base = msg.textContent;
    }
  }
  function setColor(c) {
    drawColor = c;
    document.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("active", b.dataset.color === c));
  }
  function screenToNorm(e) {
    const vp = document.querySelector("#plan-mode-stage .plan-viewport");
    const r = vp.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - st.tx) / st.scale / st.natW,
      y: (e.clientY - r.top - st.ty) / st.scale / st.natH,
    };
  }
  function drawDown(e) {
    e.preventDefault();
    const p = screenToNorm(e);
    const fid = currentFloor()?.id;
    if (tool === "wall") {
      if (!drawing) { draft = { type: "wall", floor: fid, color: drawColor, pts: [[p.x, p.y]] }; drawing = true; }
      draft.pts.push([p.x, p.y]);
      renderAnnotations();
    } else if (tool === "rect") {
      draft = { type: "rect", floor: fid, color: drawColor, x: p.x, y: p.y, w: 0, h: 0, _ox: p.x, _oy: p.y };
      drawing = true;
    } else if (tool === "arrow") {
      draft = { type: "arrow", floor: fid, color: drawColor, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      drawing = true;
    } else if (tool === "text") {
      const txt = prompt("Texto a escrever na planta:");
      if (txt && txt.trim()) {
        annots().push({ type: "text", floor: fid, color: drawColor, x: p.x, y: p.y, text: txt.trim() });
        renderAnnotations(); saveAnnotations();
      }
    } else if (tool === "erase") {
      eraseAt(p);
    }
  }
  function drawMove(e) {
    if (!drawing || !draft) return;
    const p = screenToNorm(e);
    if (draft.type === "wall") { draft._cursor = [p.x, p.y]; }
    else if (draft.type === "rect") {
      draft.x = Math.min(draft._ox, p.x); draft.y = Math.min(draft._oy, p.y);
      draft.w = Math.abs(p.x - draft._ox); draft.h = Math.abs(p.y - draft._oy);
    } else if (draft.type === "arrow") { draft.x2 = p.x; draft.y2 = p.y; }
    renderAnnotations();
  }
  function drawUp() {
    if (!drawing || !draft) return;
    if (draft.type === "wall") return;   // continua até duplo-clique
    if (draft.type === "rect" && (draft.w > 0.003 || draft.h > 0.003)) {
      delete draft._ox; delete draft._oy; annots().push(draft);
    } else if (draft.type === "arrow" &&
        (Math.abs(draft.x2 - draft.x1) > 0.003 || Math.abs(draft.y2 - draft.y1) > 0.003)) {
      annots().push(draft);
    }
    draft = null; drawing = false;
    renderAnnotations(); saveAnnotations();
  }
  function finishWall() {
    if (draft && draft.type === "wall" && draft.pts.length >= 2) {
      delete draft._cursor; annots().push(draft); saveAnnotations();
    }
    draft = null; drawing = false;
    renderAnnotations();
  }
  function cancelDraft() { draft = null; drawing = false; renderAnnotations(); }

  function eraseAt(p) {
    const list = annots();
    let idx = -1, best = 0.02;
    for (let i = 0; i < list.length; i++) {
      if (!isOnCurrentFloor(list[i])) continue;
      const d = annotDist(list[i], p);
      if (d < best) { best = d; idx = i; }
    }
    if (idx >= 0) { list.splice(idx, 1); renderAnnotations(); saveAnnotations(); }
  }
  function annotDist(a, p) {
    if (a.type === "text") return Math.hypot(a.x - p.x, a.y - p.y) - 0.01;
    if (a.type === "rect")
      return (p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h) ? 0 : 1;
    if (a.type === "arrow") return segDist(p, [a.x1, a.y1], [a.x2, a.y2]);
    if (a.type === "wall") {
      let m = 1;
      for (let i = 0; i < a.pts.length - 1; i++) m = Math.min(m, segDist(p, a.pts[i], a.pts[i + 1]));
      return m;
    }
    return 1;
  }
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p.x - a[0], p.y - a[1]);
    let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
  }

  function renderAnnotations() {
    const svg = document.getElementById("plan-mode-annot");
    if (!svg || !st.natW) return;
    const W = st.natW, H = st.natH;
    const sw = W * 0.0035;            // espessura escala com a planta
    const fs = W * 0.018;
    const all = annots().filter(isOnCurrentFloor);
    if (draft) all.push(draft);
    let out = `<defs>
      <marker id="annot-arrow" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
        <path d="M0 0 L6 3 L0 6 z" fill="context-stroke"/></marker></defs>`;
    for (const a of all) {
      if (a.type === "wall") {
        const pts = a.pts.map((p) => `${p.x * W},${p.y * H}`);
        if (a._cursor) pts.push(`${a._cursor[0] * W},${a._cursor[1] * H}`);
        out += `<polyline points="${pts.join(" ")}" fill="none" stroke="${a.color}"
                 stroke-width="${sw * 1.6}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else if (a.type === "rect") {
        out += `<rect x="${a.x * W}" y="${a.y * H}" width="${a.w * W}" height="${a.h * H}"
                 fill="none" stroke="${a.color}" stroke-width="${sw}"/>`;
      } else if (a.type === "arrow") {
        out += `<line x1="${a.x1 * W}" y1="${a.y1 * H}" x2="${a.x2 * W}" y2="${a.y2 * H}"
                 stroke="${a.color}" stroke-width="${sw * 1.3}" stroke-linecap="round"
                 marker-end="url(#annot-arrow)"/>`;
      } else if (a.type === "text") {
        out += `<text x="${a.x * W}" y="${a.y * H}" font-family="Segoe UI, Arial"
                 font-size="${fs}" font-weight="700" fill="${a.color}"
                 stroke="#fff" stroke-width="${fs * 0.22}" paint-order="stroke"
                 dominant-baseline="middle">${escapeXml(a.text)}</text>`;
      }
    }
    svg.innerHTML = out;
  }

  function saveAnnotations() {
    try { localStorage.setItem(ANNOT_KEY, JSON.stringify(annots())); } catch (e) { /* noop */ }
  }
  function restoreAnnotations(tour) {
    try {
      const raw = localStorage.getItem(ANNOT_KEY);
      if (raw) tour.data.annotations = JSON.parse(raw);
    } catch (e) { /* noop */ }
  }

  // ------------------------------------------------------- preview
  let prev = null;
  function showPreview(scene, e) {
    if (!prev) {
      prev = document.createElement("div");
      prev.id = "plan-preview";
      prev.innerHTML = `<div class="pp-thumb"></div><div class="pp-name"></div>`;
      document.body.appendChild(prev);
    }
    prev.querySelector(".pp-thumb").style.backgroundImage = `url("${scene.thumbnail || scene.panorama}")`;
    prev.querySelector(".pp-name").textContent = scene.name || scene.id;
    prev.classList.add("visible");
    movePreview(e);
  }
  function movePreview(e) {
    if (!prev) return;
    const pad = 20, w = prev.offsetWidth, h = prev.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth) x = e.clientX - w - pad;
    if (y + h > innerHeight) y = e.clientY - h - pad;
    prev.style.left = x + "px"; prev.style.top = y + "px";
  }
  function hidePreview() { prev?.classList.remove("visible"); }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  init();
})();
