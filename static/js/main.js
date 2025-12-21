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

// ✅ NOUVEAU: Charger la configuration du keepalive selon l'environnement
// En développement: configs rapides (20s)
// En production: configs optimales (30s)
const nodeEnv = window.location.hostname === 'localhost' ? 'development' : 'production';

client.init({
  assetPath: window.gameConfig.assetPath,
  receiptUrl: window.gameConfig.receiptUrl,
  limits: new LimitModel(new Big(minBet), new Big(maxBet)),
  keepAliveUrl: "/api/v1/keepalive/",
  keepAliveTick: nodeEnv === 'development' ? "20000" : "30000",  // 20s dev, 30s prod
  keepAliveTimeout: nodeEnv === 'development' ? "5000" : "8000"  // 5s dev, 8s prod
}, Messages);

/* -------------------------
   Variables DOM
------------------------- */
let ws;
let ticketToVoid = null;
let wsRetryDelay = 1000;
const wsRetryMax = 30000;
let currentRoundId = null; // Track current round for overlay management

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
      // ✅ AUTO-CLICK: Quand le timer finit, auto-cliquer sur action=finish
      console.log('⏱️ [AUTO-CLICK] Timer écoulé, envoi automatique action=finish...');
      fetch('/api/v1/rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish' })
      })
        .then(r => r.json())
        .then(data => {
          console.log('✅ [AUTO-CLICK] Action finish envoyée:', data);
          // Unlock iframe and reload when countdown finishes
          setBetFrameDisabled(false);
          reloadBetFrame();
        })
        .catch(err => {
          console.error('❌ [AUTO-CLICK] Erreur:', err.message);
          // Même en cas d'erreur, au moins réactiver les paris
          setBetFrameDisabled(false);
          reloadBetFrame();
        });
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

  // TOUJOURS transférer à app.js EN PREMIER pour une synchronisation complète
  if (window.app && window.app.handleWebSocketMessage) {
    window.app.handleWebSocketMessage(data);
  }

  // main.js gère UNIQUEMENT betFrameOverlay (overlay de l'iframe)
  // Logique : afficher à race_start, cacher à new_round (round différent) pour permettre les paris
  const activePage = document.querySelector('.page-content:not(.hidden)')?.id || 'page-dashboard';
  if (!['page-course-chevaux', 'page-dashboard', 'page-cashier'].includes(activePage)) return;

  if (data.event === 'connected') {
    // Synchroniser l'état initial : si une course est en cours, afficher l'overlay
    if (data.isRaceRunning && data.raceStartTime) {
      const roundId = data.roundId || 'N/A';
      currentRoundId = roundId;
      const elapsed = Date.now() - data.raceStartTime;
      const remaining = Math.max(0, 10000 - elapsed); // 10s max pour l'overlay
      if (remaining > 0) {
        setBetFrameDisabled(true, `Course en cours — Round ${roundId}`, remaining);
      } else {
        // L'overlay devrait déjà être terminé, permettre les paris
        setBetFrameDisabled(false);
      }
    } else if (data.roundId) {
      currentRoundId = data.roundId;
    }
    
  } else if (data.event === 'race_start') {
    // Afficher l'overlay quand la course démarre (empêcher les paris)
    // L'overlay dure 10 secondes maximum, après quoi le nouveau round sera disponible
    const roundId = data.roundId || 'N/A';
    currentRoundId = roundId;
    setBetFrameDisabled(true, `Course en cours — Round ${roundId}`, 10000); // 10 secondes max
    
  } else if (data.event === 'new_round') {
    // Nouveau round disponible : permettre les paris même si la course précédente continue
    const newRoundId = data.roundId || data.game?.id || data.currentRound?.id;
    
    if (newRoundId && newRoundId !== currentRoundId) {
      // Nouveau round différent : cacher overlay et permettre les paris
      // Ceci peut arriver pendant que la course précédente continue (isRaceRunning: true)
      console.log(`✅ Nouveau round #${newRoundId} disponible pour les paris (course précédente: ${currentRoundId})`);
      cancelLaunchCountdown();
      setBetFrameDisabled(false);
      reloadBetFrame();
      currentRoundId = newRoundId;
    } else if (!currentRoundId) {
      // Premier round ou roundId initial
      currentRoundId = newRoundId;
      // Si la course n'est pas en cours, afficher l'overlay avec le timer du round
      if (!data.isRaceRunning) {
        const durationMs = data.timer?.totalDuration || data.game?.launchDurationMs || data.game?.startInMs || 10000;
        setBetFrameDisabled(true, newRoundId ? `Jeu lancé — round ${newRoundId}` : 'Jeu en cours — veuillez patienter...', durationMs);
      }
    }
    
  } else if (data.event === 'race_end') {
    // La course est terminée, mais l'overlay devrait déjà être caché (après 10s)
    // Le nouveau round devrait déjà être disponible
    console.log('🏆 Course terminée');
  }
  else if (data.event === 'pre_start') {
    // Show a 5-second overlay/countdown before the round starts to prevent ticket deletions/emissions
    const roundId = data.roundId || 'N/A';
    const countdownMs = data.countdownMs || 5000;
    console.log(`⏳ Pré-démarrage round ${roundId} — affichage overlay ${countdownMs}ms`);
    setBetFrameDisabled(true, `Démarrage imminent — Round ${roundId}`, countdownMs);
  }
  
  // Note: refreshTickets est déjà géré par app.js, pas besoin de le refaire ici
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
    // Calculer le total des mises (les valeurs sont en système, convertir en publique)
    const total = (t.bets || []).reduce((s, b) => {
      const valueSystem = Number(b.value || 0);
      const valuePublic = Currency.systemToPublic(valueSystem);
      return s + valuePublic;
    }, 0).toFixed(Currency.visibleDigits);
    // Les tickets dans le dashboard proviennent du round actuel
    const createdTime = t.created_time || t.created_at || Date.now();
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">#${t.id}</td>
      <td class="p-2 text-slate-400 text-sm">${new Date(createdTime).toLocaleString('fr-FR')}</td>
      <td class="p-2 text-sm">${t.race || '-'}</td>
      <td class="p-2 text-green-300">${total} HTG</td>
      <td class="p-2 text-sm">${t.odds || '-'}</td>
      <td class="p-2">${formatStatus(t.status || 'pending')}</td>
      <td class="p-2">
        <button data-action="print" data-id="${t.id}" class="mr-2 text-green-300 hover:text-green-200">Imprimer</button>
        ${ (t.status||'').toLowerCase() === 'pending'
            ? `<button data-action="void" data-id="${t.id}" class="text-rose-300 hover:text-rose-200">Annuler</button>`
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
    const res = await fetch('/api/v1/rounds/', { 
      method: 'POST',
      credentials: 'include',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json' 
      },
      body: JSON.stringify({ action: 'get' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const round = data?.data || {};
    const receipts = round.receipts || [];

    // S'assurer que le roundId est synchronisé
    if (round.id) {
      const currentRoundEl = document.getElementById('currentRound');
      if (currentRoundEl) currentRoundEl.textContent = round.id;
    }

    updateTicketsTable(receipts);
    updateStats(round);
  } catch (err) {
    console.error('Erreur refreshTickets:', err);
    showToast('Erreur de connexion à l\'API.');
  }
}

function updateStats(round) {
  const receipts = round?.receipts || [];
  // Les valeurs bet.value sont en système, convertir en publique pour l'affichage
  const total = receipts.reduce((sum, r) => {
    const receiptsSum = (r.bets || []).reduce((s, b) => {
      const valueSystem = Number(b.value || 0);
      const valuePublic = Currency.systemToPublic(valueSystem);
      return s + valuePublic;
    }, 0);
    return sum + receiptsSum;
  }, 0);

  const totalBetsAmountEl = el('totalBetsAmount');
  const activeTicketsCountEl = el('activeTicketsCount');
  const currentRoundEl = el('currentRound');

  if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(Currency.visibleDigits)} HTG`;
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
