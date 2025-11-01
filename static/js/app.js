class App {
    constructor() {
        this.currentPage = 'dashboard';
        this.pages = {
            'dashboard': './pages/dashboard.html',
            'course-chevaux': './pages/course-chevaux.html',
            'betting': './pages/betting.html',
            'my-bets': './pages/my-bets.html',
            'account': './pages/account.html'
        };

        // WebSocket connection
        this.ws = null;
        this.wsRetryDelay = 1000;
        this.wsRetryMax = 30000;
        this.wsConnected = false;

        this.init();
    }

    async loadPage(pageId) {
        try {
            console.log(`Chargement de la page: ${this.pages[pageId]}`);

            const response = await fetch(this.pages[pageId]);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();

            document.getElementById('page-container').innerHTML = html;
            document.getElementById('pageTitle').textContent = this.getPageTitle(pageId);

            this.currentPage = pageId;
            this.updateActiveNavLink(pageId);

            // Réinitialiser les gestionnaires d'événements après le chargement
            this.initPageComponents(pageId);

        } catch (error) {
            console.error('Erreur lors du chargement de la page:', error);
            this.showFallbackPage(pageId, error);
        }
    }

    getPageTitle(pageId) {
        const titles = {
            'dashboard': 'Dashboard',
            'course-chevaux': 'Course Chevaux',
            'betting': 'Placer un pari',
            'my-bets': 'Mes Paris',
            'account': 'Mon Compte'
        };
        return titles[pageId] || 'Dashboard';
    }

    updateActiveNavLink(pageId) {
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.dataset.page === pageId) {
                link.classList.add('bg-[color:var(--accent)]', 'text-white');
                link.classList.remove('hover:bg-slate-800');
            } else {
                link.classList.remove('bg-[color:var(--accent)]', 'text-white');
                link.classList.add('hover:bg-slate-800');
            }
        });
    }

    initPageComponents(pageId) {
        // Réinitialiser les gestionnaires d'événements globaux
        this.setupGlobalEventListeners();

        switch (pageId) {
            case 'dashboard':
                this.initDashboard();
                break;
            case 'course-chevaux':
                this.initCourseChevaux();
                break;
            case 'my-bets':
                this.initMyBets();
                break;
            case 'betting':
                this.initBetting();
                break;
        }
    }

    initDashboard() {
        console.log('Initialisation de la page Dashboard');

        // Références aux fonctions de refresh pour WebSocket
        this.dashboardRefreshTickets = null;
        this.dashboardUpdateStats = null;

        // Helper function
        const el = (id) => document.getElementById(id);

        /* -------------------------
           Mise à jour du tableau
        ------------------------- */
        const updateTicketsTable = (tickets) => {
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
      <td class="p-2 text-slate-400 text-sm">${new Date(t.created_at || Date.now()).toLocaleString()}</td>
      <td class="p-2 text-sm">${t.race || '-'}</td>
      <td class="p-2 text-green-300">${total} HTG</td>
      <td class="p-2 text-sm">${t.odds ?? '-'}</td>
      <td class="p-2">${formatStatus(t.status)}</td>
      <td class="p-2">
        <button data-action="print" data-id="${t.id}" class="mr-2 text-green-300">Imprimer</button>
        ${(t.status || '').toLowerCase() === 'pending'
                        ? `<button data-action="void" data-id="${t.id}" class="text-rose-300">Annuler</button>`
                        : ''}
      </td>
    `;
                table.appendChild(tr);
            });
        }

        /* -------------------------
           Rafraîchissement
        ------------------------- */
        const refreshTickets = async () => {
            try {
                const res = await fetch('/api/v1/rounds/', { 
                    method: 'POST', 
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

                updateTicketsTable(receipts);
                updateStats(round);
            } catch (err) {
                console.error('Erreur refreshTickets:', err);
                this.showToast('Erreur de connexion à l\'API.', 'error');
            }
        };

        const updateStats = (round) => {
            const receipts = round?.receipts || [];
            const total = receipts.reduce((sum, r) => sum + (r.bets || []).reduce((s, b) => s + Number(b.value || 0), 0), 0);

            // lookup DOM elements lazily (page injectée dynamiquement par App)
            const totalBetsAmountEl = document.getElementById('totalBetsAmount');
            const activeTicketsCountEl = document.getElementById('activeTicketsCount');
            const currentRoundEl = document.getElementById('currentRound');

            if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(2)} HTG`;
            if (activeTicketsCountEl) activeTicketsCountEl.textContent = receipts.length;
            if (currentRoundEl && round?.id) currentRoundEl.textContent = round.id;
        }

        // Stocker les fonctions pour utilisation par WebSocket
        this.dashboardRefreshTickets = refreshTickets;
        this.dashboardUpdateStats = updateStats;

        // Rafraîchir immédiatement
        refreshTickets();

        // Configurer le bouton de rafraîchissement
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => refreshTickets());
        }

        // Le WebSocket mettra à jour automatiquement via handleWebSocketMessage
        console.log('✅ Dashboard initialisé avec WebSocket en temps réel');
    }

    initCourseChevaux() {
        // Initialiser la page Course Chevaux
        console.log('Initialisation de la page Course Chevaux');
        // Le jeu devrait s'initialiser automatiquement via les scripts existants
    }

    initMyBets() {
        console.log("%c[INIT] Chargement de la page Mes Paris...", "color: #3b82f6");

        const API_URL = '/api/v1/my-bets/';
        let currentPage = 1;
        let totalPages = 1;

        // Référence pour WebSocket
        this.myBetsFetchMyBets = null;

        // Sélecteurs
        const dateFilter = document.getElementById('dateFilter');
        const statusFilter = document.getElementById('myBetsStatusFilter');
        const searchIdInput = document.getElementById('searchBetId');
        const refreshButton = document.getElementById('refreshMyBets');
        const totalBetAmountEl = document.getElementById('myTotalBetAmount');
        const potentialWinningsEl = document.getElementById('myPotentialWinnings');
        const activeTicketsCountEl = document.getElementById('myActiveTicketsCount');
        const winRateEl = document.getElementById('myWinRate');
        const ticketsTableBody = document.getElementById('ticketsTable');
        const displayedRangeEl = document.getElementById('displayedRange');
        const totalMyBetsEl = document.getElementById('totalMyBets');
        const currentPageEl = document.getElementById('currentPage');
        const prevPageBtn = document.getElementById('prevPage');
        const nextPageBtn = document.getElementById('nextPage');

        // === FONCTIONS ===
        async function fetchMyBets(page = 1) {
            console.log("[FETCH] Chargement des paris (page " + page + ")");
            currentPage = page;
            setLoading(true);

            const params = new URLSearchParams({ page, limit: 10 });
            if (dateFilter.value) params.append('date', dateFilter.value);
            if (statusFilter.value) params.append('status', statusFilter.value);
            if (searchIdInput.value.trim()) params.append('searchId', searchIdInput.value.trim());

            try {
                const response = await fetch(`${API_URL}?${params.toString()}`);
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || "Erreur serveur");

                updateStats(result.data.stats);
                updateTable(result.data.tickets);
                updatePagination(result.data.pagination);
            } catch (err) {
                console.error("[ERREUR FETCH]", err);
                renderError("Impossible de charger les données.");
            } finally {
                setLoading(false);
            }
        }

        function updateStats(stats) {
            totalBetAmountEl.textContent = `${(stats.totalBetAmount || 0).toFixed(2)} HTG`;
            potentialWinningsEl.textContent = `${(stats.potentialWinnings || 0).toFixed(2)} HTG`;
            activeTicketsCountEl.textContent = stats.activeTicketsCount || 0;
            winRateEl.textContent = `${stats.winRate || 0}%`;
        }

        function updateTable(tickets) {
            ticketsTableBody.innerHTML = '';
            if (!tickets || tickets.length === 0) {
                ticketsTableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Aucun ticket trouvé</td></tr>`;
                return;
            }

            tickets.forEach(t => {
                ticketsTableBody.innerHTML += `
                <tr class="hover:bg-slate-700/50">
                    <td class="p-2 text-sm font-medium">#${t.id}</td>
                    <td class="p-2 text-sm text-slate-300">${formatDate(t.date)}</td>
                    <td class="p-2 text-sm text-slate-300">Course #${t.roundId}</td>
                    <td class="p-2 text-sm font-semibold">${t.totalAmount.toFixed(2)} HTG</td>
                    <td class="p-2 text-sm text-slate-300">x${t.avgCoeff.toFixed(2)}</td>
                    <td class="p-2">${formatStatus(t.status)}</td>
                    <td class="p-2 flex gap-2">
                        <button class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded" 
                            onclick="window.open('/api/v1/receipts/?action=print&id=${t.id}', '_blank')">
                            🖨️
                        </button>
                        ${t.status === 'pending' ? `
                            <button class="px-2 py-1 bg-red-600 hover:bg-red-700 text-xs rounded" onclick="cancelTicket(${t.id})">❌</button>` : ''}
                        ${t.status === 'won' ? `
                            <button class="px-2 py-1 bg-green-600 hover:bg-green-700 text-xs rounded" onclick="payTicket(${t.id})">💵</button>` : ''}
                    </td>
                </tr>
            `;
            });
        }

        async function payTicket(id) {
            if (!confirm(`Confirmer le paiement du ticket #${id} ?`)) return;
            try {
                const res = await fetch(`/api/v1/tickets/pay/${id}`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || "Erreur lors du paiement");
                alert(`✅ Ticket #${id} payé avec succès.`);
                fetchMyBets(currentPage);
            } catch (e) {
                alert(`❌ ${e.message}`);
            }
        }

        async function cancelTicket(id) {
            if (!confirm(`Annuler le ticket #${id} ?`)) return;
            try {
                const res = await fetch(`/api/v1/tickets/cancel/${id}`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || "Erreur lors de l'annulation");
                alert(`❌ Ticket #${id} annulé.`);
                fetchMyBets(currentPage);
            } catch (e) {
                alert(`⚠️ ${e.message}`);
            }
        }

        function updatePagination(p) {
            totalPages = p.totalPages || 1;
            displayedRangeEl.textContent = p.displayedRange || '0-0';
            totalMyBetsEl.textContent = p.totalItems || 0;
            currentPageEl.textContent = `Page ${p.currentPage || 1}`;
            prevPageBtn.disabled = p.currentPage <= 1;
            nextPageBtn.disabled = p.currentPage >= totalPages;
        }

        function setLoading(state) {
            if (state) {
                ticketsTableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Chargement...</td></tr>`;
            }
            refreshButton.disabled = state;
        }

        function renderError(msg) {
            ticketsTableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-400">${msg}</td></tr>`;
        }

        function formatDate(date) {
            return new Date(date).toLocaleString('fr-FR');
        }

        function formatStatus(status) {
            const base = "px-2.5 py-0.5 rounded-full text-xs font-medium";
            const map = {
                pending: "bg-yellow-500/20 text-yellow-400",
                won: "bg-green-500/20 text-green-400",
                lost: "bg-red-500/20 text-red-400",
                cancelled: "bg-slate-500/20 text-slate-400"
            };
            return `<span class="${base} ${map[status] || 'bg-slate-600 text-slate-300'}">${status}</span>`;
        }

        // === Événements ===
        refreshButton.addEventListener("click", () => fetchMyBets(1));
        prevPageBtn.addEventListener("click", () => currentPage > 1 && fetchMyBets(currentPage - 1));
        nextPageBtn.addEventListener("click", () => currentPage < totalPages && fetchMyBets(currentPage + 1));

        // Stocker la fonction pour WebSocket
        this.myBetsFetchMyBets = fetchMyBets;

        // Chargement initial
        fetchMyBets(1);

        console.log('✅ Mes Paris initialisé avec WebSocket en temps réel');
    }


    initBetting() {
        // Initialiser la page de pari
        console.log('Initialisation de la page de pari');
    }

    setupGlobalEventListeners() {
        // Gestion des clics pour les boutons d'action des tickets
        document.addEventListener('click', (e) => {
            // Imprimer
            if (e.target.matches('[data-action="print"]') || e.target.closest('[data-action="print"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="print"]').dataset.id;
                if (typeof printTicket === 'function') {
                    printTicket(ticketId);
                }
                return;
            }

            // Annuler
            if (e.target.matches('[data-action="void"]') || e.target.closest('[data-action="void"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="void"]').dataset.id;
                if (typeof showVoidModal === 'function') {
                    showVoidModal(ticketId);
                }
                return;
            }

            // Payer
            if (e.target.matches('[data-action="pay"]') || e.target.closest('[data-action="pay"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="pay"]').dataset.id;
                if (typeof payTicket === 'function') {
                    payTicket(ticketId);
                }
                return;
            }
        });
    }

    setupEventListeners() {
        // Navigation
        document.addEventListener('click', (e) => {
            const navLink = e.target.closest('.nav-link');
            if (navLink) {
                e.preventDefault();
                const pageId = navLink.dataset.page;
                this.loadPage(pageId);

                if (window.innerWidth < 1024) {
                    document.getElementById('sidebar').classList.add('hidden');
                }
            }
        });

        // Menu mobile
        document.getElementById('mobileOpenBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('hidden');
        });

        // Déconnexion
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout();
        });
    }

    showFallbackPage(pageId, error) {
        const fallbackContent = {
            'dashboard': `
                <div class="bg-slate-800 rounded-xl p-6">
                    <h2 class="font-semibold mb-4">Dashboard</h2>
                    <p class="text-red-400">Erreur de chargement: ${error.message}</p>
                    <p class="text-slate-400 mt-2">Le tableau des tickets sera affiché ici une fois le serveur configuré.</p>
                </div>
            `,
            'course-chevaux': `
                <div class="bg-slate-800 rounded-xl p-6">
                    <h2 class="font-semibold mb-4">Course Chevaux</h2>
                    <p class="text-slate-400">Interface des courses en cours.</p>
                </div>
            `,
            'betting': `
                <div class="bg-slate-800 rounded-xl p-6">
                    <h2 class="font-semibold mb-4">Placer un pari</h2>
                    <p class="text-slate-400">Interface de placement de paris.</p>
                </div>
            `,
            'my-bets': `
                <div class="bg-slate-800 rounded-xl p-6">
                    <h2 class="font-semibold mb-4">Mes Paris</h2>
                    <p class="text-slate-400">Historique et gestion de mes paris.</p>
                </div>
            `,
            'account': `
                <div class="bg-slate-800 rounded-xl p-6">
                    <h2 class="font-semibold mb-4">Mon Compte</h2>
                    <p class="text-slate-400">Gestion du compte caissier.</p>
                </div>
            `
        };

        document.getElementById('page-container').innerHTML = fallbackContent[pageId] || fallbackContent.dashboard;
        document.getElementById('pageTitle').textContent = this.getPageTitle(pageId);
        this.updateActiveNavLink(pageId);
    }

    showToast(message, type = 'info') {
        const toastEl = document.getElementById('toast');
        const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

        toastEl.innerHTML = `<div class="${bgColor} text-white px-4 py-2 rounded shadow">${message}</div>`;
        toastEl.classList.remove('hidden');

        setTimeout(() => {
            toastEl.classList.add('hidden');
        }, 3000);
    }

    logout() {
        if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
            this.showToast('Déconnexion...');
            setTimeout(() => {
                window.location.href = '/login';
            }, 1000);
        }
    }

    // =================================================================
    // ===           GESTION WEBSOCKET                               ===
    // =================================================================

    connectWebSocket() {
        if (!window.wsConfig || !window.wsConfig.connectionString) {
            console.error('❌ Configuration WebSocket non trouvée. Assurez-vous que websocket-config.js est chargé.');
            setTimeout(() => this.connectWebSocket(), 2000); // Réessayer dans 2s
            return;
        }

        try {
            this.ws = new WebSocket(window.wsConfig.connectionString);
        } catch (err) {
            console.error('❌ Impossible d\'ouvrir WebSocket:', err);
            this.scheduleWsReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('✅ WebSocket connecté:', window.wsConfig.connectionString);
            this.wsConnected = true;
            this.wsRetryDelay = 1000;
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (e) {
                console.error('❌ Erreur parsing WebSocket:', e);
            }
        };

        this.ws.onclose = () => {
            console.warn('⚠️ WebSocket fermé, reconnexion dans', this.wsRetryDelay, 'ms...');
            this.wsConnected = false;
            this.scheduleWsReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('❌ Erreur WebSocket:', err);
            this.wsConnected = false;
        };
    }

    scheduleWsReconnect() {
        setTimeout(() => {
            this.connectWebSocket();
            this.wsRetryDelay = Math.min(this.wsRetryDelay * 2, this.wsRetryMax);
        }, this.wsRetryDelay);
    }

    handleWebSocketMessage(data) {
        console.log('📨 WebSocket message reçu:', data.event);

        switch (data.event) {
            case 'connected':
                console.log('🔌 WebSocket connecté, round actuel:', data.roundId);
                // Rafraîchir immédiatement pour avoir les données à jour
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets();
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1);
                }
                break;

            case 'new_round':
                console.log('🆕 Nouveau tour:', data.game?.id);
                // Mettre à jour le round actuel
                const currentRoundEl = document.getElementById('currentRound');
                if (currentRoundEl && data.game?.id) {
                    currentRoundEl.textContent = data.game.id;
                }
                // Rafraîchir les données
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets();
                }
                // Les tickets en attente restent valides mais sont liés à l'ancien round
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1);
                }
                break;

            case 'race_start':
                console.log('🏁 Course démarrée');
                // Optionnel: Désactiver les paris pendant la course
                break;

            case 'race_end':
                console.log('🏆 Course terminée, gagnant:', data.winner);
                // Rafraîchir immédiatement pour voir les résultats
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    setTimeout(() => this.dashboardRefreshTickets(), 500); // Petit délai pour laisser le serveur traiter
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    setTimeout(() => this.myBetsFetchMyBets(1), 500);
                }
                this.showToast(`🏆 Course terminée ! Gagnant: ${data.winner?.name || 'N/A'}`, 'success');
                break;

            case 'ticket_update':
            case 'receipt_added':
            case 'receipt_deleted':
                console.log('🎫 Mise à jour des tickets');
                // Rafraîchir les données immédiatement
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets();
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1);
                }
                break;

            default:
                console.log('📨 Événement WebSocket non géré:', data.event);
        }
    }

    init() {
        this.setupEventListeners();
        this.loadPage('dashboard');

        // Initialiser WebSocket
        this.connectWebSocket();
    }
}

// Initialiser l'application quand le DOM est chargé
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});