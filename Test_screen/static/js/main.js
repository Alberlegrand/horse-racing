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
window.wsConfig = {
  connectionString: "ws://localhost:8081/connection/websocket",
  token: "LOCAL_TEST_TOKEN",
  userId: "local.6130290",
  partnerId: "platform_horses"
};

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

const currentRoundEl = document.getElementById('currentRound');
const totalBetsAmountEl = document.getElementById('totalBetsAmount');
const activeTicketsCountEl = document.getElementById('activeTicketsCount');
const ticketsTableEl = document.getElementById('ticketsTable');
const voidModal = document.getElementById('voidModal');
const modalTicketIdEl = document.getElementById('modalTicketId');
const cancelVoidBtn = document.getElementById('cancelVoidBtn');
const confirmVoidBtn = document.getElementById('confirmVoidBtn');
const pageTitleEl = document.getElementById('pageTitle');
const pageContents = document.querySelectorAll('.page-content');
const navLinks = document.querySelectorAll('.nav-link');
const mobileOpenBtn = document.getElementById('mobileOpenBtn');
const sidebar = document.getElementById('sidebar');
const toastEl = document.getElementById('toast');

/* -------------------------
   Helpers
------------------------- */
function showToast(message, duration = 3000) {
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
  if (!['page-course-chevaux', 'page-dashboard'].includes(activePage)) return;

  if (data.event === 'new_round') {
    if (data.game?.id) {
      if (currentRoundEl) currentRoundEl.textContent = data.game.id;
      else console.warn("⚠️ Élément #currentRound introuvable au moment de la mise à jour.");
    }
    refreshTickets();
  } else if (['race_end', 'ticket_update'].includes(data.event)) {
    refreshTickets();
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
