(() => {
  const SIDEBAR_ID = "codex-env-sidebar";
  const STORAGE_KEY = "codexSidebar.env";
  const FAVORITES_KEY = "codexSidebar.env.favs";
  const SIDEBAR_W_CSSVAR = "--csw";
  const CODEX_PATH_PREFIX = "/codex";
  const CODEX_HOST = "https://chatgpt.com";

  // Botão do dropdown (você mostrou no HTML)
  const ENV_DROPDOWN_BTN_SEL = 'button[aria-label="Exibir todos os ambientes de programação"]';

  // Popover do Radix: aparece no DOM quando abre
  const POPOVER_SEL = 'div.popover';
  const POPOVER_ENV_SECTION_TEXT = 'Ambientes';

  // Linha de tarefa (você mostrou)
  const TASK_ROW_SEL = 'div.border-token-border-light.grid.w-full';

  const state = {
    envs: [],
    selected: null,
    favorites: [],
    updating: false,
  };

  const qs = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const isOnCodexPage = () => {
    if (location.origin !== CODEX_HOST) return false;
    const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
    return normalizedPath === CODEX_PATH_PREFIX;
  };

  function debounce(fn, wait=200){
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function loadSelected(){
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && typeof v === "string" && v.trim() !== "") state.selected = v;
    } catch {}
  }
  function saveSelected(v){
    try {
      if (!v) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, v);
    } catch {}
  }
  function loadFavorites(){
    try{
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.favorites = arr.filter(x => typeof x === "string");
    } catch {}
  }
  function saveFavorites(){
    try{
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
    } catch {}
  }

  function ensureSidebar(){
    if (qs("#"+SIDEBAR_ID)) return;

    const el = document.createElement("div");
    el.id = SIDEBAR_ID;
    el.innerHTML = `
      <header>
        <div class="title">Environments</div>
        <button class="refresh" type="button" title="Refresh" aria-label="Refresh ">
          <span class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-8 4.47" />
              <path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 8-4.47" />
              <path d="M3 5v5h5" />
              <path d="M21 19v-5h-5" />
            </svg>
          </span>
          <span class="label">Refresh</span>
        </button>
      </header>
      <div class="list"></div>
      <div class="meta">
        <span class="m-env">—</span>
        <span class="m-count">0</span>
      </div>
    `;
    document.body.appendChild(el);

    qs(".refresh", el).addEventListener("click", () => refreshFromDropdown(true));
  }

  function setSidebarVisibility(visible){
    const el = qs("#"+SIDEBAR_ID);
    if (!el) return;
    el.style.display = visible ? "" : "none";
    document.documentElement.classList.toggle("codex-sidebar-on", visible);
  }

  function handleRouteChange(){
    const onCodex = isOnCodexPage();
    const sidebar = qs("#"+SIDEBAR_ID);
    if (!onCodex){
      if (sidebar) setSidebarVisibility(false);
      return;
    }
    if (!sidebar) ensureSidebar();
    setSidebarVisibility(true);
    renderSidebar();
    applyTaskFilter();
  }

  function observeUrlChanges(){
    let lastHref = location.href;
    const check = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      handleRouteChange();
    };

    const origPush = history.pushState;
    history.pushState = function(...args){
      const ret = origPush.apply(this, args);
      check();
      return ret;
    };

    const origReplace = history.replaceState;
    history.replaceState = function(...args){
      const ret = origReplace.apply(this, args);
      check();
      return ret;
    };

    window.addEventListener("popstate", check);

    const mo = new MutationObserver(() => {
      if (location.href !== lastHref) check();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function setMeta(){
    console.log('setMeta');
    const el = qs("#"+SIDEBAR_ID);
    if (!el) return;
    const env = state.selected || "All environments";
    qs(".m-env", el).textContent = env;

    const visible = countVisibleTasks();
    qs(".m-count", el).textContent = `${visible} tasks`;
  }

  function renderSidebar(){
    const el = qs("#"+SIDEBAR_ID);
    if (!el) return;

    const list = qs(".list", el);
    list.innerHTML = "";

    const addBtn = (name, active, isFav=false) => {
      const row = document.createElement("div");
      row.className = "env-row" + (isFav ? " fav" : "");

      const b = document.createElement("button");
      b.type = "button";
      b.className = "env" + (active ? " active" : "");
      b.textContent = name;
      b.addEventListener("click", () => onSelectEnv(name === "Todos" ? null : name));

      if (name !== "Todos"){
        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "fav-toggle" + (isFav ? " on" : "");
        favBtn.title = isFav ? "Remover dos favoritos" : "Adicionar aos favoritos";
        favBtn.textContent = isFav ? "★" : "☆";
        favBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFavorite(name);
        });
        row.appendChild(favBtn);
      } else {
        // alinhamento consistente
        const spacer = document.createElement("div");
        spacer.className = "fav-toggle spacer";
        row.appendChild(spacer);
      }

      row.appendChild(b);
      list.appendChild(row);
    };

    const sorted = [...state.envs].sort((a,b)=>a.localeCompare(b));
    const favorites = sorted.filter(env => state.favorites.includes(env));
    const others = sorted.filter(env => !state.favorites.includes(env));

    favorites.forEach(env => addBtn(env, env === state.selected, true));
    addBtn("Todos", !state.selected);
    others.forEach(env => addBtn(env, env === state.selected, false));

    setMeta();
  }

  function findTaskContainer(){
    // Container que envolve as linhas
    // No HTML: <div class="flex flex-col justify-center pb-20"><div class="flex flex-col">...
    // Vamos achar pelo primeiro row e subir alguns níveis para observar só essa área.
    const row = qs(TASK_ROW_SEL);
    if (!row) return null;
    let node = row;
    for (let i=0; i<6 && node; i++){
      if (node.classList && node.classList.contains("flex") && node.classList.contains("flex-col")) {
        // heurística simples
      }
      node = node.parentElement;
    }
    // fallback: usar o pai direto do primeiro task-row-container
    const trc = qs(".task-row-container");
    return trc ? trc.parentElement : null;
  }

  function getEnvFromTaskRow(row){
    const spans = qsa("span", row).map(s => (s.textContent||"").trim()).filter(Boolean);
    const candidates = spans.filter(t => t.includes("/") && !t.startsWith("http"));
    return candidates.length ? candidates[candidates.length-1] : null;
  }

  function applyTaskFilter(){
    console.log('applyTaskFilter');
    if (!isOnCodexPage()) return;
    const rows = qsa(TASK_ROW_SEL);
    const selected = state.selected;

    rows.forEach(row => {
      const env = getEnvFromTaskRow(row);
      row.style.display = (!selected || env === selected) ? "" : "none";
    });

    setMeta();
    updateSectionVisibility();
  }

  function updateSectionVisibility(){
    console.log('updateSectionVisibility');
    // Quando aplicamos o filtro por ambiente, o Codex ainda mantém os headers
    // ("Hoje", "Últimos 7 dias", etc.). Se todas as linhas de uma seção estiverem
    // ocultas, escondemos o header para evitar seções vazias.
    //
    // Heurística: localizar headers que têm a classe uppercase e fazem parte
    // do mesmo container que possui task rows.
    const anyRow = qs(TASK_ROW_SEL);
    if (!anyRow) return;

    // Sobe até um container comum (lista principal) para limitar o escopo.
    const root = anyRow.closest("main") || document.body;
    const headers = qsa("div.text-token-text-tertiary.uppercase", root);
    if (!headers.length) return;

    for (let i = 0; i < headers.length; i++){
      const h = headers[i];
      // percorre nós irmãos até o próximo header
      let node = h.nextElementSibling;
      let visible = 0;
      while (node && !(node.classList.contains("text-token-text-tertiary") && node.classList.contains("uppercase"))){
        const rowsIn = qsa(TASK_ROW_SEL, node);
        for (const r of rowsIn){
          if (getComputedStyle(r).display !== "none") visible++;
        }
        node = node.nextElementSibling;
        if (node && node.classList.contains("text-token-text-tertiary") && node.classList.contains("uppercase")) break;
      }
      h.style.display = visible === 0 ? "none" : "";
    }
  }

  function countVisibleTasks(){
    const rows = qsa(TASK_ROW_SEL);
    let c = 0;
    rows.forEach(r => {
      if (getComputedStyle(r).display !== "none") c++;
    });
    return c;
  }

  function extractEnvsFromPopover(popover){
    // Confirma que é o popover certo (tem o texto "Ambientes")
    const hasAmbientes = qsa("*", popover).some(n => (n.textContent||"").trim() === POPOVER_ENV_SECTION_TEXT);
    if (!hasAmbientes) return [];

    const envs = new Set();
    const buttons = qsa("button", popover);
    for (const b of buttons){
      const t = (b.textContent||"").trim();
      if (!t) continue;
      if (t.includes("Configurar repositórios")) continue;
      if (t.includes("Gerenciar ambientes")) continue;
      // item de ambiente é "org/repo"
      if (t.includes("/")) envs.add(t);
    }
    return Array.from(envs);
  }

  async function waitForPopover(timeoutMs=1500){
    const start = Date.now();
    while (Date.now()-start < timeoutMs){
      const pops = qsa(POPOVER_SEL);
      for (const p of pops){
        const envs = extractEnvsFromPopover(p);
        if (envs.length) return { popover: p, envs };
      }
      await sleep(50);
    }
    return null;
  }

  async function openDropdownIfClosed(){
    const btn = qs(ENV_DROPDOWN_BTN_SEL);
    if (!btn) return false;

    // Se já existir um popover com ambientes, não precisa clicar
    const existing = await waitForPopover(50);
    if (existing) return true;

    btn.click();
    return true;
  }

  async function refreshFromDropdown(forceOpen=false){
    if (state.updating) return;
    state.updating = true;
    try{
      if (forceOpen) {
        const ok = await openDropdownIfClosed();
        if (!ok) return;
      }
      const found = await waitForPopover(1800);
      if (!found) return;

      const envs = found.envs;
      if (!envs.length) return;

      const changed = envs.length !== state.envs.length || envs.some(e => !state.envs.includes(e));
      if (changed){
        state.envs = envs;

        // Remove favoritos que não existem mais
        state.favorites = state.favorites.filter(f => state.envs.includes(f));
        saveFavorites();

        // Se o selecionado sumiu, volta para Todos
        if (state.selected && !state.envs.includes(state.selected)){
          state.selected = null;
          saveSelected(null);
        }
        renderSidebar();
      }
    } finally {
      state.updating = false;
    }
  }

  async function clickEnvInDropdown(envName){
    // Abre dropdown e clica no botão correspondente
    const ok = await openDropdownIfClosed();
    if (!ok) return;

    const found = await waitForPopover(1800);
    if (!found) return;

    const { popover } = found;

    const buttons = qsa("button", popover);
    const target = buttons.find(b => (b.textContent||"").trim() === envName);
    if (target) target.click();
  }

  async function onSelectEnv(envNameOrNull){
    // Sidebar -> mesma ação do dropdown
    if (!envNameOrNull){
      state.selected = null;
      saveSelected(null);
      renderSidebar();
      applyTaskFilter();
      return;
    }

    state.selected = envNameOrNull;
    saveSelected(envNameOrNull);
    renderSidebar();
    applyTaskFilter();

    // Sincroniza com UI do dropdown
    await clickEnvInDropdown(envNameOrNull);
  }

  function toggleFavorite(name){
    const set = new Set(state.favorites);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    state.favorites = Array.from(set);
    saveFavorites();
    renderSidebar();
  }

  function hookDropdownClick(){
    // Quando o usuário clicar no dropdown, atualiza a lista da sidebar
    document.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(ENV_DROPDOWN_BTN_SEL) : null;
      if (!btn) return;
      // Espera abrir e atualiza
      refreshFromDropdown(false);
    }, true);
  }

  function observeTasks(){
    // O Codex pode inserir novas tarefas em diferentes pontos do DOM conforme
    // o usuário rola ("Hoje", "Últimos 7 dias", etc.). Se observarmos apenas um
    // container, o filtro passa a aplicar só na primeira seção.
    //
    // Solução: observar o documento e reaplicar o filtro de forma debounce.
    // Também ignoramos mutações geradas pela nossa própria sidebar para evitar loops.
    const container = findTaskContainer() || document.body;
    const onMut = debounce(() => {
      applyTaskFilter();
    }, 200);

    const mo = new MutationObserver((mutations) => {
      const sidebar = qs("#"+SIDEBAR_ID);
      // Se todas as mutações são dentro da sidebar, ignora.
      if (sidebar){
        const onlySidebar = mutations.every(m => sidebar === m.target || sidebar.contains(m.target));
        if (onlySidebar) return;
      }
      onMut();
    });
    mo.observe(container, { childList: true, subtree: true });
  }

  async function init(){
    loadSelected();
    loadFavorites();
    observeUrlChanges();
    hookDropdownClick();

    handleRouteChange();
    if (!isOnCodexPage()) return;

    ensureSidebar();
    // Primeira renderização: tenta puxar lista completa via dropdown (sem travar)
    // Não força abrir: só atualiza se o popover existir; senão deixa vazio até o usuário abrir.
    await refreshFromDropdown(false);

    // Se não vier nada, coloca o selecionado atual do topo (texto do botão do dropdown) como fallback
    if (!state.envs.length){
      const btnText = qs(ENV_DROPDOWN_BTN_SEL)?.innerText?.trim();
      if (btnText && btnText.includes("/")) state.envs = [btnText];
    }

    // Se não tem selected salvo, tenta pegar o atual do dropdown
    if (!state.selected){
      const current = qs(ENV_DROPDOWN_BTN_SEL)?.innerText?.trim();
      if (current && current.includes("/")) state.selected = current;
    }

    renderSidebar();
    applyTaskFilter();
    observeTasks();

    // Após carregar tudo, dispara um refresh forçado para preencher a lista automaticamente.
    setTimeout(() => refreshFromDropdown(true), 300);
  }

  // Aguarda a UI montar
  setTimeout(init, 800);
})();
