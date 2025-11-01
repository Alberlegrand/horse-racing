/* -------------------------
   Messages et Config
------------------------- */
let Messages = {
  TITLE: "Round N $id",
  MONEY_AMOUNT: "$value HTG",
  PAYOUT: "Payment",
  TOTAL: "Total",
  WINNER: "Winner of the round № $id",
  BET_TOO_SMALL: "The minimum bet is $value. Make one more bet.",
  BET_TOO_BIG: "The maximum bet is $value. Make a smaller bet.",
  NO_BETS: "Bets are not defined.",
  NO_RECEIPTS: "No receipts.",
  AJAX_TIMEOUT: "Failed to send request. Please check your internet connection",
};

let client = new WebClient();
let minBet = 1000;
let maxBet = 500000;
let showDecimal = false;

// Configuration WebSocket et jeu
// Note: wsConfig devrait être défini par websocket-config.js
// On ne définit une config par défaut que si elle n'existe pas déjà
if (!window.wsConfig) {
  window.wsConfig = {
    connectionString: "ws://localhost:8081/connection/websocket",
    token: "LOCAL_TEST_TOKEN",
    userId: "local.6130290",
    partnerId: "platform_horses"
  };
  console.warn("⚠️ wsConfig non trouvé, utilisation de la config par défaut. Assurez-vous que websocket-config.js est chargé.");
}

window.gameConfig = {
  enableReceiptPrinting: true,
  receiptUrl: "/api/v1/receipts",
  assetPath: "/img/",
};

if (showDecimal) Currency.changeDigits({ digits: 2, visibleDigits: 2 });
else Currency.changeDigits({ digits: 2, visibleDigits: 0 });

client.init({
  assetPath: window.gameConfig.assetPath,
  receiptUrl: window.gameConfig.receiptUrl,
  limits: new LimitModel(new Big(minBet), new Big(maxBet)),
  keepAliveUrl: "/api/v1/keepalive/",
  keepAliveTick: "20000",
  keepAliveTimeout: "5000"
}, Messages);

/* -------------------------
   Variables DOM
------------------------- */
let ws;
let ticketToVoid = null;
let wsRetryDelay = 1000;
const wsRetryMax = 30000;

/* -------------------------
   Helpers
------------------------- */
function showToast(message, duration = 3000) {
  const toastEl = el('toast');
  if (!toastEl) return console.warn('Toast element missing');
  toastEl.innerHTML = `<div class="bg-slate-800 text-white px-4 py-2 rounded shadow">${message}</div>`;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function el(id) {
  return document.getElementById(id);
}

function formatStatus(status) {
  const statusMap = {
    pending: { text: 'En attente', class: 'bg-yellow-500/20 text-yellow-400' },
    won: { text: 'Gagné', class: 'bg-green-500/20 text-green-400' },
    lost: { text: 'Perdu', class: 'bg-red-500/20 text-red-400' },
    void: { text: 'Annulé', class: 'bg-slate-500/20 text-slate-400' },
    paid: { text: 'Payé', class: 'bg-blue-500/20 text-blue-400' },
  };
  const st = (status || 'pending').toLowerCase();
  const info = statusMap[st] || statusMap.pending;
  return `<span class="px-2 py-1 rounded-full text-xs font-medium ${info.class}">${info.text}</span>`;
}

/* -------------------------
   Helpers pour bet_frame
------------------------- */
let _launchCountdownInterval = null;
let _launchCountdownStart = 0;
let _launchCountdownDuration = 0;

function _formatSeconds(s) {
  return `${s}s`;
}

function startLaunchCountdown(durationMs) {
  cancelLaunchCountdown();
  if (!durationMs || durationMs <= 0) return;
  const progressBar = document.getElementById('betLaunchProgressBar');
  const timerEl = document.getElementById('betLaunchTimer');
  if (!progressBar || !timerEl) return;

  _launchCountdownStart = Date.now();
  _launchCountdownDuration = durationMs;
  progressBar.style.width = '0%';
  timerEl.textContent = _formatSeconds(Math.ceil(durationMs / 1000));

  _launchCountdownInterval = setInterval(() => {
    const elapsed = Date.now() - _launchCountdownStart;
    const pct = Math.min(100, (elapsed / _launchCountdownDuration) * 100);
    progressBar.style.width = pct + '%';
    const remainingSec = Math.max(0, Math.ceil((_launchCountdownDuration - elapsed) / 1000));
    timerEl.textContent = _formatSeconds(remainingSec);

    if (elapsed >= _launchCountdownDuration) {
      cancelLaunchCountdown();
      // Unlock iframe and reload when countdown finishes
      setBetFrameDisabled(false);
      reloadBetFrame();
    }
  }, 100);
}

function cancelLaunchCountdown() {
  if (_launchCountdownInterval) {
    clearInterval(_launchCountdownInterval);
    _launchCountdownInterval = null;
  }
  const progressBar = document.getElementById('betLaunchProgressBar');
  const timerEl = document.getElementById('betLaunchTimer');
  if (progressBar) progressBar.style.width = '0%';
  if (timerEl) timerEl.textContent = '';
}

function setBetFrameDisabled(disabled = true, message, durationMs) {
  const overlay = document.getElementById('betFrameOverlay');
  const textEl = document.getElementById('betFrameOverlayText');
  if (!overlay) return;
  if (message && textEl) textEl.textContent = message;
  if (disabled) {
    cancelLaunchCountdown(); // reset previous if any
    overlay.classList.remove('hidden');
    overlay.classList.remove('opacity-0');
    overlay.classList.add('opacity-100');
    if (durationMs && durationMs > 0) startLaunchCountdown(durationMs);
  } else {
    // fade out then hide to keep transition smooth
    cancelLaunchCountdown();
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0');
    setTimeout(() => overlay.classList.add('hidden'), 300);
  }
}

function reloadBetFrame() {
  const iframe = document.getElementById('betFrame');
  if (!iframe) return;
  const base = iframe.getAttribute('src')?.split('?')[0] || '/bet_frame';
  iframe.setAttribute('src', base + '?t=' + Date.now());
}

/* -------------------------
   WebSocket
------------------------- */
function connectWebSocket() {
  const url = window.wsConfig.connectionString;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('Impossible d\'ouvrir WebSocket:', err);
    scheduleWsReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('WebSocket connecté');
    wsRetryDelay = 1000;
  };

  ws.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error("Erreur parsing WS:", e);
      return;
    }
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    console.warn('WebSocket déconnecté — reconnexion dans', wsRetryDelay, 'ms');
    scheduleWsReconnect();
  };

  ws.onerror = (err) => {
    console.error('Erreur WebSocket:', err);
  };
}

function scheduleWsReconnect() {
  setTimeout(() => {
    connectWebSocket();
    wsRetryDelay = Math.min(wsRetryDelay * 2, wsRetryMax);
  }, wsRetryDelay);
}

function handleWebSocketMessage(data) {
  const activePage = document.querySelector('.page-content:not(.hidden)')?.id || 'page-dashboard';
  if (!['page-course-chevaux', 'page-dashboard', 'page-cashier'].includes(activePage)) return;

  console.log('📨 main.js WebSocket:', data.event);

  if (data.event === 'new_round') {
    if (data.game?.id) {
      const currentRoundEl = document.getElementById('currentRound');
      if (currentRoundEl) currentRoundEl.textContent = data.game.id;
    }
    // read duration if present (ms) or fallback to 10s
    const durationMs = data.game?.launchDurationMs ?? data.game?.startInMs ?? 10000;
    setBetFrameDisabled(true, data.game?.id ? `Jeu lancé — round ${data.game.id}` : 'Jeu en cours — veuillez patienter...', durationMs);
    if (typeof refreshTickets === 'function') {
      refreshTickets();
    }
    // Notifier app.js si disponible
    if (window.app && window.app.handleWebSocketMessage) {
      window.app.handleWebSocketMessage(data);
    }
  } else if (data.event === 'race_end') {
    // stop countdown, enable and reload iframe
    cancelLaunchCountdown();
    setBetFrameDisabled(false);
    reloadBetFrame();
    if (typeof refreshTickets === 'function') {
      refreshTickets();
    }
    // Notifier app.js si disponible
    if (window.app && window.app.handleWebSocketMessage) {
      window.app.handleWebSocketMessage(data);
    }
  } else if (data.event === 'ticket_update' || data.event === 'receipt_added' || data.event === 'receipt_deleted') {
    if (typeof refreshTickets === 'function') {
      refreshTickets();
    }
    // Notifier app.js si disponible
    if (window.app && window.app.handleWebSocketMessage) {
      window.app.handleWebSocketMessage(data);
    }
  } else {
    // Transférer les autres événements à app.js si disponible
    if (window.app && window.app.handleWebSocketMessage) {
      window.app.handleWebSocketMessage(data);
    }
  }
}

/* -------------------------
   Mise à jour du tableau
------------------------- */
function updateTicketsTable(tickets) {
  const table = el('ticketsTable');
  if (!table) return console.warn('⚠️ #ticketsTable introuvable');

  table.innerHTML = '';

  if (!tickets || tickets.length === 0) {
    table.innerHTML = `<tr><td colspan="7" class="p-4 text-slate-400">Aucun ticket</td></tr>`;
    return;
  }

  tickets.forEach(t => {
    const total = (t.bets || []).reduce((s, b) => s + Number(b.value || 0), 0).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">#${t.id}</td>
      <td class="p-2 text-slate-400 text-sm">${new Date(t.created_at||Date.now()).toLocaleString()}</td>
      <td class="p-2 text-sm">${t.race||'-'}</td>
      <td class="p-2 text-green-300">${total} HTG</td>
      <td class="p-2 text-sm">${t.odds ?? '-'}</td>
      <td class="p-2">${formatStatus(t.status)}</td>
      <td class="p-2">
        <button data-action="print" data-id="${t.id}" class="mr-2 text-green-300">Imprimer</button>
        ${ (t.status||'').toLowerCase() === 'pending'
            ? `<button data-action="void" data-id="${t.id}" class="text-rose-300">Annuler</button>`
            : '' }
      </td>
    `;
    table.appendChild(tr);
  });
}

/* -------------------------
   Rafraîchissement
------------------------- */
async function refreshTickets() {
  try {
    const res = await fetch('/api/v1/rounds/?action=get', { method: 'POST', headers: { 'Accept': 'application/json' }});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const round = data?.data || {};
    const receipts = round.receipts || [];

    updateTicketsTable(receipts);
    updateStats(round);
  } catch (err) {
    console.error('Erreur refreshTickets:', err);
    showToast('Erreur de connexion à l’API.');
  }
}

function updateStats(round) {
  const receipts = round?.receipts || [];
  const total = receipts.reduce((sum, r) => sum + (r.bets||[]).reduce((s,b)=> s + Number(b.value||0),0), 0);

  const totalBetsAmountEl = el('totalBetsAmount');
  const activeTicketsCountEl = el('activeTicketsCount');
  const currentRoundEl = el('currentRound');

  if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(2)} HTG`;
  if (activeTicketsCountEl) activeTicketsCountEl.textContent = receipts.length;
  if (currentRoundEl && round.id) currentRoundEl.textContent = round.id;
}

/* -------------------------
   Init
------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  refreshTickets();
});
