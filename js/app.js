(() => {
  const STORAGE_KEY = "chinchon-offline-v1";
  const $ = (id) => document.getElementById(id);

  const state = {
    limit: 200,
    players: [],
    rounds: [],
    undoStack: [],
    startedAt: null,
    finishedAt: null,
    seenAlerts: {},
  };

  let pendingInstall = null;

  const warningNear = [
    (n, left) => `${n} está a ${left} puntos del límite.`,
    (n, left) => `${n} tiene ${left} puntos restantes antes del cierre.`,
    (n, left) => `${n} necesita cuidar el margen: le quedan ${left}.`,
  ];
  const warningOut = [
    (n) => `${n} llegó al límite y quedó eliminado.`,
    (n) => `${n} supera el tope y sale de la mesa.`,
    (n) => `${n} alcanza el máximo y queda fuera.`,
  ];

  const uid = () =>
    crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function iconMarkup(name) {
    const icons = {
      crown: "crown",
      spark: "sparkles",
      alert: "triangle-alert",
      exit: "door-open",
      card: "credit-card",
      camera: "camera",
      install: "download",
      medalGold: "medal",
      medalSilver: "medal",
      medalBronze: "medal"
    };
    const key = icons[name] || "sparkles";
    return `<i data-lucide="${key}"></i>`;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      Object.assign(state, data);
      return Boolean(state.players?.length);
    } catch {
      return false;
    }
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    $(id).classList.add("active");
    $("dock").hidden = id !== "screen-game";
  }

  function activePlayers() {
    return state.players.filter((p) => p.status === "active");
  }

  function lastPlaceScore() {
    const pool = activePlayers();
    if (!pool.length) {
      const others = state.players.filter((p) => p.status !== "inactive");
      return others.length ? Math.max(...others.map((p) => p.total)) : 0;
    }
    return Math.max(...pool.map((p) => p.total));
  }

  function recompute() {
    for (const p of state.players) p.total = p.startingScore || 0;
    for (const round of state.rounds) {
      for (const [pid, pts] of Object.entries(round.scores)) {
        const p = state.players.find((x) => x.id === pid);
        if (p) p.total += Number(pts) || 0;
      }
    }
    for (const p of state.players) {
      if (p.status === "inactive") continue;
      p.status = p.total >= state.limit ? "eliminated" : "active";
    }
  }

  function setupRows(names = ["", ""]) {
    const wrap = $("setupPlayers");
    wrap.innerHTML = "";
    names.forEach((name, i) => wrap.appendChild(makeSetupRow(name, i)));
  }

  function makeSetupRow(name, index) {
    const row = document.createElement("div");
    row.className = "setup-row";
    row.innerHTML = `
      <input type="text" maxlength="16" placeholder="Jugador ${index + 1}" value="${escapeHtml(name)}" autocomplete="nickname" />
      <button type="button" class="icon-btn" aria-label="Quitar">×</button>
    `;
    row.querySelector("button").onclick = () => {
      if ($("setupPlayers").children.length <= 2) return;
      row.remove();
      refreshStartEnabled();
    };
    row.querySelector("input").addEventListener("input", refreshStartEnabled);
    return row;
  }

  function setupNames() {
    return [...$("setupPlayers").querySelectorAll("input")]
      .map((i) => i.value.trim())
      .filter(Boolean);
  }

  function refreshStartEnabled() {
    $("startGame").disabled = setupNames().length < 2;
  }

  function startGame() {
    const names = setupNames();
    if (names.length < 2) return;
    state.players = names.map((name) => ({
      id: uid(),
      name,
      startingScore: 0,
      joinRound: 0,
      total: 0,
      status: "active",
    }));
    state.rounds = [];
    state.undoStack = [];
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.seenAlerts = {};
    save();
    renderGame();
    showScreen("screen-game");
  }

  function renderGame() {
    $("roundLabel").textContent = `Ronda ${state.rounds.length + 1}`;
    $("limitPill").textContent = `Límite ${state.limit}`;
    $("undoBtn").disabled = state.rounds.length === 0 && state.undoStack.length === 0;
    $("dock").hidden = false;
    renderBoard();
  }

  function remaining(p) {
    return state.limit - p.total;
  }

  function joinRoundOf(player) {
    if (typeof player.joinRound === "number") return player.joinRound;
    const idx = state.rounds.findIndex((r) => r.scores[player.id] !== undefined);
    return idx < 0 ? 0 : idx;
  }

  function runningAfter(player, roundIndex) {
    let t = player.startingScore || 0;
    for (let i = 0; i <= roundIndex; i++) {
      const s = state.rounds[i].scores[player.id];
      if (s !== undefined) t += Number(s) || 0;
    }
    return t;
  }

  function lastPlayedIndex(player) {
    for (let i = state.rounds.length - 1; i >= 0; i--) {
      if (i >= joinRoundOf(player)) return i;
    }
    return -1;
  }

  function tallyClass(player, value, isCurrent) {
    if (!isCurrent) return "tally struck";
    if (player.status === "eliminated" || value >= state.limit) return "tally now dead";
    if (player.status === "active" && state.limit - value <= 25) return "tally now warn";
    return "tally now";
  }

  function renderBoard() {
    const board = $("boardPanel");
    const list = state.players;
    const n = Math.max(list.length, 1);
    const minWidth = Math.max(100, n * 104 + 56);
    const lastByPlayer = Object.fromEntries(list.map((p) => [p.id, lastPlayedIndex(p)]));

    const head = list
      .map((p) => {
        const out = p.status !== "active" ? "col-out" : "";
        const elim = p.status === "active"
          ? `<button type="button" class="elim-link" data-drop="${p.id}" aria-label="Retirarse ${escapeHtml(p.name)}">${iconMarkup("exit")}</button>`
          : `<span class="elim-link is-state">${p.status === "eliminated" ? "eliminado" : "baja"}</span>`;
        return `<th class="${out}">
          <div class="col-head">
            <span class="col-name">${escapeHtml(p.name)}</span>
            ${elim}
          </div>
        </th>`;
      })
      .join("");

    const roundRows = state.rounds
      .map((_, i) => {
        const cells = list
          .map((p) => {
            if (i < joinRoundOf(p)) return `<td><div class="tally empty">·</div></td>`;
            const value = runningAfter(p, i);
            const showCurrent = i === lastByPlayer[p.id];
            const inherited = (p.startingScore || 0) !== 0 && i === joinRoundOf(p)
              ? `<div class="tally struck">${p.startingScore}</div>`
              : "";
            return `<td>${inherited}<div class="${tallyClass(p, value, showCurrent)}">${value}</div></td>`;
          })
          .join("");
        return `<tr>${cells}<td></td></tr>`;
      })
      .join("");

    const inheritedRow = list.some((p) => (p.startingScore || 0) !== 0 && lastPlayedIndex(p) < 0)
      ? `<tr>${list
          .map((p) => {
            if ((p.startingScore || 0) === 0 || lastPlayedIndex(p) >= 0) {
              return `<td><div class="tally empty">·</div></td>`;
            }
            return `<td><div class="${tallyClass(p, p.startingScore, true)}">${p.startingScore}</div></td>`;
          })
          .join("")}<td></td></tr>`
      : "";

    const inputs = list
      .map((p) => {
        if (p.status !== "active") {
          return `<td class="input-cell"><div class="frozen-note">—</div></td>`;
        }
        return `<td class="input-cell">
          <input class="score-input" inputmode="numeric" pattern="-?[0-9]*" data-pid="${p.id}" data-special="normal" placeholder="+" aria-label="Puntos de ${escapeHtml(p.name)}" />
          <div class="ink-actions">
            <button type="button" data-fill="${p.id}" data-val="0" data-special="normal">0</button>
            <button type="button" data-fill="${p.id}" data-val="-10" data-special="normal">-10</button>
            <button type="button" class="wide" data-fill="${p.id}" data-val="-10" data-special="chinchon">Chinchón</button>
          </div>
        </td>`;
      })
      .join("");

    const warn = list
      .filter((p) => p.status === "active" && remaining(p) <= 25)
      .map((p) => pickLine(warningNear, p.name, Math.max(0, remaining(p))))
      .concat(list.filter((p) => p.status === "eliminated").map((p) => pickLine(warningOut, p.name)))[0] || "";

    board.innerHTML = `
      <div class="pad">
        <div class="pad-scroll">
          <table class="chinchon-sheet" style="min-width:${minWidth}px">
            <thead>
              <tr>
                ${head}
                <th class="add-head">
                  <button type="button" class="add-circle" data-add aria-label="Agregar jugador">+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              ${roundRows}
              ${inheritedRow}
              <tr>${inputs}<td></td></tr>
            </tbody>
          </table>
        </div>
        <div class="pad-foot">${warn}</div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    board.querySelectorAll("[data-fill]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.special === "chinchon") {
          finishGame();
          return;
        }

        const input = board.querySelector(`input[data-pid="${btn.dataset.fill}"]`);
        if (input) {
          input.value = btn.dataset.val;
          input.dataset.special = btn.dataset.special || "normal";
        }
      };
    });
    board.querySelectorAll("[data-drop]").forEach((btn) => {
      btn.onclick = () => dropPlayer(btn.dataset.drop);
    });
    board.querySelector("[data-add]").onclick = openModal;
  }

  function pickLine(arr, name, extra) {
    const i = Math.abs(hash(name)) % arr.length;
    return arr[i](name, extra);
  }

  function hash(s) {
    return [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  }

  function renderHistory() {
    const el = $("historyPanel");
    if (!state.rounds.length) {
      el.innerHTML = `<div class="sheet empty">Todavía no hay rondas. Anotá la primera y acá queda el diario de la mesa.</div>`;
      return;
    }
    el.innerHTML = [...state.rounds]
      .reverse()
      .map((round, idx) => {
        const n = state.rounds.length - idx;
        const lines = state.players
          .map((p) => {
            const pts = round.scores[p.id];
            if (pts === undefined) return `<div class="history-line"><span>${escapeHtml(p.name)}</span><span>—</span></div>`;
            const label = Number(pts) === -10 ? `${pts} chinchón` : pts;
            return `<div class="history-line"><span>${escapeHtml(p.name)}</span><span>${label}</span></div>`;
          })
          .join("");
        return `<article class="history-round"><h3>Ronda ${n}</h3>${lines}</article>`;
      })
      .join("");
  }

  function nextRound() {
    const inputs = [...document.querySelectorAll(".score-input")];
    const scores = {};
    const chinchonUsed = inputs.some((input) => input.dataset.special === "chinchon" && input.value.trim() !== "");
    for (const input of inputs) {
      const raw = input.value.trim().replace(",", ".");
      if (raw === "" || raw === "-") {
        input.focus();
        pulse(input);
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        input.focus();
        pulse(input);
        return;
      }
      scores[input.dataset.pid] = n;
    }
    if (!Object.keys(scores).length) return;

    const before = Object.fromEntries(state.players.map((p) => [p.id, p.status]));
    state.undoStack.push({ type: "round", at: Date.now() });
    state.rounds.push({ id: uid(), scores, at: Date.now() });
    recompute();
    save();
    const newlyOut = state.players.filter((p) => before[p.id] === "active" && p.status === "eliminated");
    renderGame();
    inputs.forEach((i) => (i.value = ""));
    if (newlyOut.length) {
      const p = newlyOut[0];
      openToast("spark", "Límite alcanzado", pickLine(warningOut, p.name));
    } else {
      const danger = activePlayers()
        .map((p) => ({ p, left: remaining(p) }))
        .filter((x) => x.left <= 10)
        .sort((a, b) => a.left - b.left)[0];
      if (danger && !state.seenAlerts[danger.p.id + "-" + danger.left]) {
        state.seenAlerts[danger.p.id + "-" + danger.left] = true;
        save();
        openToast("alert", "Puntos críticos", pickLine(warningNear, danger.p.name, danger.left));
      }
    }
    if (activePlayers().length <= 1 && !chinchonUsed) {
      setTimeout(() => finishGame(), 650);
    }
  }

  function pulse(el) {
    el.style.borderBottomColor = "#9b1824";
    el.style.background = "rgba(155, 24, 36, 0.08)";
    setTimeout(() => {
      el.style.borderBottomColor = "";
      el.style.background = "";
    }, 700);
  }

  function undo() {
    const lastAction = state.undoStack[state.undoStack.length - 1];
    if (!lastAction) {
      if (!state.rounds.length) return;
      state.rounds.pop();
      recompute();
      save();
      renderGame();
      return;
    }

    state.undoStack.pop();

    if (lastAction.type === "drop") {
      const p = state.players.find((x) => x.id === lastAction.playerId);
      if (p) {
        p.status = lastAction.beforeStatus || "active";
      }
      save();
      renderGame();
      return;
    }

    if (lastAction.type === "round") {
      if (state.rounds.length) {
        state.rounds.pop();
      }
      recompute();
      save();
      renderGame();
    }
  }

  function addMidPlayer(name) {
    const clean = name.trim();
    if (!clean) return;
    const inherited = lastPlaceScore();
    state.players.push({
      id: uid(),
      name: clean,
      startingScore: inherited,
      joinRound: state.rounds.length,
      total: inherited,
      status: inherited >= state.limit ? "eliminated" : "active",
    });
    save();
    renderGame();
    openToast("card", "Se suma a la mesa", `${clean} hereda ${inherited} puntos (el último de la tabla).`);
  }

  function dropPlayer(id) {
    const p = state.players.find((x) => x.id === id);
    if (!p || p.status !== "active") return;
    state.undoStack.push({ type: "drop", playerId: p.id, beforeStatus: p.status, at: Date.now() });
    p.status = "inactive";
    save();
    renderGame();
    if (activePlayers().length <= 1) {
      openToast("exit", "Jugador retirado", `${p.name} abandonó la mesa. Podés cerrar la partida cuando quieras.`);
    }
  }

  function ranking() {
    return [...state.players].sort((a, b) => {
      if (a.status === "inactive" && b.status !== "inactive") return 1;
      if (b.status === "inactive" && a.status !== "inactive") return -1;
      return a.total - b.total || a.name.localeCompare(b.name, "es");
    });
  }

  function finishGame() {
    recompute();
    state.finishedAt = Date.now();
    save();
    renderPodium();
    showScreen("screen-podium");
    $("dock").hidden = true;
  }

  function renderPodium() {
    const list = ranking();
    const medals = [iconMarkup("medalGold"), iconMarkup("medalSilver"), iconMarkup("medalBronze")];
    const date = new Date(state.finishedAt || Date.now()).toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    $("podioCard").innerHTML = `
      <div class="podium-brand">
        <small>Contador Chinchón Offline</small>
        <h2>Podio final</h2>
        <p>${date} · límite ${state.limit}</p>
      </div>
      ${list
        .map((p, i) => {
          const playing = list.filter((x) => x.status !== "inactive");
          const last = p.status !== "inactive" && p.id === playing[playing.length - 1]?.id && playing.length > 1;
          const cls = i === 0 ? "place first" : last ? "place last" : "place";
          const badge = p.status === "inactive" ? iconMarkup("exit") : last ? iconMarkup("spark") : medals[i] || `${i + 1}°`;
          const extra = p.status === "inactive" ? " · retiró" : last ? " · último activo" : "";
          return `<div class="${cls}">
            <div class="rank">${badge}</div>
            <div class="who">${escapeHtml(p.name)}${extra}</div>
            <div class="pts">${p.total} pts</div>
          </div>`;
        })
        .join("")}
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  async function sharePodium() {
    if (typeof html2canvas !== "function") {
      openToast("camera", "Sin captura", "La librería de imagen no cargó. Probá de nuevo con conexión la primera vez.");
      return;
    }
    const node = $("podioCard");
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#0b3d2c" });
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const file = new File([blob], "podio-chinchon.png", { type: "image/png" });
    const caption = buildCaption();
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Podio Chinchón", text: caption });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Podio Chinchón", text: caption });
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "podio-chinchon.png";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function buildCaption() {
    const list = ranking();
    const lines = list.map((p, i) => `${i + 1}. ${p.name} ${p.total}`);
    return `Podio Chinchón\n${lines.join("\n")}`;
  }

  function newGame() {
    localStorage.removeItem(STORAGE_KEY);
    state.players = [];
    state.rounds = [];
    state.finishedAt = null;
    state.seenAlerts = {};
    setupRows(["", ""]);
    refreshStartEnabled();
    showScreen("screen-setup");
  }

  function openToast(icon, title, text) {
    $("toastEmoji").innerHTML = iconMarkup(icon);
    if (window.lucide) window.lucide.createIcons();
    $("toastTitle").textContent = title;
    $("toastText").textContent = text;
    $("toast").classList.add("show");
  }

  function closeToast() {
    $("toast").classList.remove("show");
  }

  function openModal() {
    $("modalTitle").textContent = "Agregar jugador";
    $("modalHint").textContent = `Entra con ${lastPlaceScore()} puntos, el puntaje de quien va último.`;
    $("modalInput").value = "";
    $("modal").classList.add("show");
    setTimeout(() => $("modalInput").focus(), 50);
  }

  function closeModal() {
    $("modal").classList.remove("show");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function resume() {
    if (!load()) {
      setupRows(["", ""]);
      refreshStartEnabled();
      showScreen("screen-setup");
      return;
    }
    recompute();
    if (state.finishedAt) {
      renderPodium();
      showScreen("screen-podium");
      return;
    }
    renderGame();
    showScreen("screen-game");
  }

  $("addSetupPlayer").onclick = () => {
    const n = $("setupPlayers").children.length;
    $("setupPlayers").appendChild(makeSetupRow("", n));
  };

  $("limitGrid").onclick = (e) => {
    const btn = e.target.closest("[data-limit]");
    if (!btn) return;
    state.limit = Number(btn.dataset.limit);
    $("limitGrid").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === btn));
  };

  $("startGame").onclick = startGame;
  $("nextRound").onclick = nextRound;
  $("undoBtn").onclick = undo;
  $("endGameBtn").onclick = finishGame;
  $("sharePodium").onclick = sharePodium;
  $("newGame").onclick = newGame;
  $("toastOk").onclick = closeToast;
  $("modalCancel").onclick = closeModal;
  $("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  $("modalForm").onsubmit = (e) => {
    e.preventDefault();
    addMidPlayer($("modalInput").value);
    closeModal();
  };

  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios && !standalone) {
    $("installBanner").classList.add("show");
    $("installBtn").textContent = "En Safari: Compartir y Agregar a inicio";
    $("installBtn").onclick = () => openToast("install", "Instalar en iPhone", "Abrí el botón Compartir de Safari y elegí Agregar a pantalla de inicio.");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pendingInstall = e;
    $("installBanner").classList.add("show");
    $("installBtn").textContent = "Agregar a inicio";
    $("installBtn").onclick = async () => {
      if (!pendingInstall) return;
      pendingInstall.prompt();
      await pendingInstall.userChoice;
      pendingInstall = null;
      $("installBanner").classList.remove("show");
    };
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }

  if (window.lucide) window.lucide.createIcons();
  resume();
})();
