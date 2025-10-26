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
        
// Configuration pour la connexion WebSocket
window.wsConfig = {
    connectionString: "ws://localhost:8081/connection/websocket",
    token: "LOCAL_TEST_TOKEN",
    userId: "local.6130290",
    partnerId: "platform_horses"
};

// Configuration spécifique au jeu, y compris l'impression
window.gameConfig = {
    enableReceiptPrinting: true ,
    receiptUrl: "/api/v1/receipts",
    assetPath: "/img/",
    // ... potentiellement d'autres paramètres de jeu ...
};

        if (showDecimal) Currency.changeDigits({ digits: 2, visibleDigits: 2 });
        else Currency.changeDigits({ digits: 2, visibleDigits: 0 });

        client.init(
            {
                // Corrigé : Utilise la configuration globale
                assetPath: window.gameConfig.assetPath,
                receiptUrl: window.gameConfig.receiptUrl,
                limits: new LimitModel(new Big(minBet), new Big(maxBet)),
                keepAliveUrl: "/api/v1/keepalive/",
                keepAliveTick: "20000",
                keepAliveTimeout: "5000"
            },
            Messages
        );

// Supprimé : La redéfinition redondante de window.wsConfig a été enlevée.

         //Script principal -->
   
        /* -------------------------
           Variables & Sélecteurs
           ------------------------- */
        let ws;
        let ticketToVoid = null;
        let wsRetryDelay = 1000;
        const wsRetryMax = 30000;

        // Elements du DOM
        const currentRoundEl = document.getElementById('currentRound');
        const totalBetsAmountEl = document.getElementById('totalBetsAmount');
        const activeTicketsCountEl = document.getElementById('activeTicketsCount');
        const ticketsTableEl = document.getElementById('ticketsTable');

        // Modal
        const voidModal = document.getElementById('voidModal');
        const modalTicketIdEl = document.getElementById('modalTicketId');
        const cancelVoidBtn = document.getElementById('cancelVoidBtn');
        const confirmVoidBtn = document.getElementById('confirmVoidBtn');

        // Navigation
        const pageTitleEl = document.getElementById('pageTitle');
        const pageContents = document.querySelectorAll('.page-content');
        const navLinks = document.querySelectorAll('.nav-link');

        // UI
        const mobileOpenBtn = document.getElementById('mobileOpenBtn');
        const sidebar = document.getElementById('sidebar');
        const refreshBtn = document.getElementById('refreshBtn');
        const toastEl = document.getElementById('toast');

        /* -------------------------
           Helpers
           ------------------------- */
        function showToast(message, duration = 3000) {
            toastEl.innerHTML = `<div class="bg-slate-800 text-white px-4 py-2 rounded shadow">${message}</div>`;
            toastEl.classList.remove('hidden');
            setTimeout(() => {
                toastEl.classList.add('hidden');
            }, duration);
        }

        function safeJSONParse(str) {
            try { return JSON.parse(str); } catch (e) { return null; }
        }

        // Fonction helper (définie une seule fois)
        function el(id) { 
            return document.getElementById(id); 
        }

        function formatStatus(status) {
            const statusMap = {
                'pending': { text: 'En attente', class: 'bg-yellow-500/20 text-yellow-400' },
                'won': { text: 'Gagné', class: 'bg-green-500/20 text-green-400' },
                'lost': { text: 'Perdu', class: 'bg-red-500/20 text-red-400' },
                'void': { text: 'Annulé', class: 'bg-slate-500/20 text-slate-400' },
                'paid': { text: 'Payé', class: 'bg-blue-500/20 text-blue-400' }
            };

            const st = (status || 'pending').toLowerCase();
            const info = statusMap[st] || statusMap.pending;
            
            return `<span class="px-2 py-1 rounded-full text-xs font-medium ${info.class}">${info.text}</span>`;
        }

        /* -------------------------
           WebSocket
           ------------------------- */
        function connectWebSocket() {
        // Corrigé : Utilise la configuration globale
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
                    console.error("Erreur de parsing WebSocket JSON:", e);
                    return;
                }
                handleWebSocketMessage(data);
            };

            ws.onclose = () => {
                console.log('WebSocket déconnecté. Tentative de reconnexion dans', wsRetryDelay, 'ms');
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

            if (!['page-course-chevaux', 'page-dashboard'].includes(activePage)) {
                return;
            }

            if (data.event === 'new_round') {
                if (data.game?.id) currentRoundEl.textContent = data.game.id;
                refreshTickets();
            } else if (data.event === 'race_end') {
                refreshTickets();
            } else if (data.event === 'ticket_update') {
                refreshTickets();
            }
        }

        function updateTicketsTable(tickets) {
            const ticketsTableEl = el('ticketsTable');
            if (!ticketsTableEl) {
                console.warn('updateTicketsTable: #ticketsTable introuvable, skip update');
                return;
            }

            ticketsTableEl.innerHTML = '';

            if (!tickets || tickets.length === 0) {
              ticketsTableEl.innerHTML = `<tr><td colspan="7" class="p-4 text-slate-400">Aucun ticket</td></tr>`;
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
                                      ${ (t.status||'').toLowerCase() === 'pending' ? `<button data-action="void" data-id="${t.id}" class="text-rose-300">Annuler</button>` : '' }
                </td>
              `;
              ticketsTableEl.appendChild(tr);
            });
          }

        // Ajouté : Fonction déplacée depuis l'IIFE supprimée
        function updateStats(round) {
            const totalBetsAmountEl = el('totalBetsAmount');
            const activeTicketsCountEl = el('activeTicketsCount');
            const currentRoundEl = el('currentRound');

            const receipts = round?.receipts || [];
            const total = receipts.reduce((sum, r) => sum + (r.bets||[]).reduce((s,b)=> s + Number(b.value||0),0), 0);

            if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(2)} HTG`;
            if (activeTicketsCountEl) activeTicketsCountEl.textContent = receipts.length;
            if (currentRoundEl && round.id) currentRoundEl.textContent = round.id;
        }

        /* -------------------------
           API : refresh tickets (version unique)
           ------------------------- */
        async function refreshTickets() {
            try {
                const response = await fetch('/api/v1/rounds/?action=get', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                const round = data?.data || data || {};
                const receipts = round.receipts || [];
                
                // Utilise la fonction helper 'el'
                const ticketsTableEl = el('ticketsTable');
                if (ticketsTableEl) {
                    updateTicketsTable(receipts);
                }
                
                // Met à jour les stats (maintenant updateStats est dans le scope global)
                if (el('totalBetsAmount') || el('activeTicketsCount') || el('currentRound')) {
                    updateStats(round);
                }
            } catch (error) {
                console.error("Erreur lors du rafraîchissement des tickets:", error);
                const ticketsTableEl = el('ticketsTable');
                if (ticketsTableEl) {
                    ticketsTableEl.innerHTML = `<tr><td colspan="7" class="px-6 py-4 text-center text-red-500">Erreur de connexion à l'API.</td></tr>`;
                }
                showToast && showToast('Impossible de récupérer les tickets (API).', 4000);
            }
        }


// Supprimé : L'IIFE (Immediately Invoked Function Expression) redondante a été enlevée.
// Les fonctions `refreshTickets` et `updateStats` dupliquées sont supprimées.
// Le `DOMContentLoaded` et le `setInterval` dupliqués sont supprimés.


        function printTicket(ticketId) {
            window.open(`/api/v1/receipts/?action=print&id=${ticketId}`, '_blank');
            showToast('Ouverture du ticket pour impression...');
        }

        function showVoidModal(ticketId) {
            ticketToVoid = ticketId;
            modalTicketIdEl.textContent = ticketId;
            voidModal.classList.remove('hidden');
        }

        function hideVoidModal() {
            voidModal.classList.add('hidden');
            ticketToVoid = null;
        }

        async function confirmVoidTicket() {
            if (!ticketToVoid) return;
            try {
                const response = await fetch(`/api/v1/receipts/?action=delete&id=${ticketToVoid}`, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                if (data?.data?.success || data?.success) {
                    showToast('Ticket annulé avec succès');
                    refreshTickets();
                } else {
                    console.error("Échec de l'annulation du ticket:", data);
                    showToast('Échec de l\'annulation', 4000);
                }
            } catch (error) {
                console.error("Erreur lors de l'annulation:", error);
                showToast('Erreur lors de l\'annulation', 4000);
            } finally {
                hideVoidModal();
            }
        }

        async function payTicket(ticketId) {
            try {
                const response = await fetch(`/api/v1/receipts/?action=pay&id=${ticketId}`, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                if (data?.data?.success || data?.success) {
                    showToast('Paiement effectué');
                    refreshTickets();
                } else {
                    showToast('Échec du paiement', 4000);
                    console.error('Erreur paiement', data);
                }
            } catch (err) {
                console.error('Erreur paiement', err);
                showToast('Erreur lors du paiement', 4000);
            }
        }

        /* -------------------------
           Navigation SPA
           ------------------------- */
        function switchPage(pageId, pageTitle) {
            pageContents.forEach(page => page.classList.add('hidden'));
            const newPage = document.getElementById(pageId);
            if (newPage) newPage.classList.remove('hidden');

            if (pageTitle) pageTitleEl.textContent = pageTitle;

            navLinks.forEach(link => {
                if (link.dataset.page === pageId.replace('page-', '')) {
                    link.classList.add('bg-[color:var(--accent)]', 'text-white');
                    link.classList.remove('hover:bg-slate-800');
                } else {
                    link.classList.remove('bg-[color:var(--accent)]', 'text-white');
                    link.classList.add('hover:bg-slate-800');
                }
            });

            if (pageId === 'page-course-chevaux' || pageId === 'page-dashboard') {
                refreshTickets();
            }
        }

        /* -------------------------
           Initialisation (unique)
           ------------------------- */
        document.addEventListener('DOMContentLoaded', () => {
            connectWebSocket();
            refreshTickets(); // Appel initial

            // Minuteur de rafraîchissement unique
            setInterval(() => {
                const activePage = document.querySelector('.page-content:not(.hidden)')?.id;
                if (['page-course-chevaux', 'page-dashboard'].includes(activePage)) {
                    refreshTickets();
                }
            }, 10000);

            // Gestionnaire d'événements global
            document.body.addEventListener('click', (e) => {
                // Note: Les sélecteurs .print-btn, .void-btn, .pay-btn ont été remplacés
                // par data-action dans 'updateTicketsTable'. Ajustons ici.
                
                const actionBtn = e.target.closest('button[data-action]');
                if (actionBtn) {
                    const action = actionBtn.dataset.action;
                    const id = actionBtn.dataset.id;
                    
                    if (action === 'print') {
                        e.preventDefault();
                        printTicket(id);
                        return;
                    }

                    if (action === 'void') {
                        e.preventDefault();
                        showVoidModal(id);
                        return;
                    }
                }
                
                // Garde les anciens sélecteurs au cas où ils seraient utilisés ailleurs
                const printBtn = e.target.closest('.print-btn');
                if (printBtn) {
                    e.preventDefault();
                    printTicket(printBtn.dataset.ticketId);
                    return;
                }

                const voidBtn = e.target.closest('.void-btn');
                if (voidBtn) {
                    e.preventDefault();
                    showVoidModal(voidBtn.dataset.ticketId);
                    return;
                }

                const payBtn = e.target.closest('.pay-btn');
                if (payBtn) {
                    e.preventDefault();
                    payTicket(payBtn.dataset.ticketId);
                    return;
                }

                const navLink = e.target.closest('.nav-link');
                if (navLink) {
                    e.preventDefault();
                    const pageId = 'page-' + navLink.dataset.page;
                    const pageTitle = navLink.dataset.title || navLink.textContent.trim();
                    switchPage(pageId, pageTitle);
                    if (window.innerWidth < 1024) sidebar.classList.add('hidden');
                    return;
                }
            });

            // Écouteurs pour la modale et les boutons UI
            cancelVoidBtn.addEventListener('click', hideVoidModal);
            confirmVoidBtn.addEventListener('click', confirmVoidTicket);

            mobileOpenBtn.addEventListener('click', () => {
                sidebar.classList.toggle('hidden');
            });

            refreshBtn.addEventListener('click', refreshTickets);

            document.getElementById('logoutBtn').addEventListener('click', () => {
                showToast('Déconnexion (placeholder)');
            });
        });