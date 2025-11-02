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

        // Variables pour le timer de lancement (identique à screen.html)
        this.timerTotalDelayMs = 120000; // 2 minutes par défaut
        this.timerTargetEndTime = 0; // Timestamp exact de la fin du compte à rebours
        this.timerCountdownInterval = null; // ID de l'intervalle pour la mise à jour de la barre

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
                // Calculer le total des mises
                const total = (t.bets || []).reduce((s, b) => s + Number(b.value || 0), 0).toFixed(2);
                // Récupérer le roundId - les tickets du dashboard proviennent du round actuel
                // On peut le récupérer depuis le round actuel ou depuis le ticket lui-même
                const roundId = t.roundId || '-'; // Le roundId devrait être dans le ticket depuis l'API
                const createdTime = t.created_time || t.created_at || Date.now();
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
      <td class="p-2">#${t.id}</td>
      <td class="p-2 text-slate-400 text-sm">${new Date(createdTime).toLocaleString('fr-FR')}</td>
      <td class="p-2 text-sm">Round #${roundId}</td>
      <td class="p-2 text-green-300">${total} HTG</td>
      <td class="p-2 text-sm">${t.odds || '-'}</td>
      <td class="p-2">${formatStatus(t.status || 'pending')}</td>
      <td class="p-2">
        <button data-action="print" data-id="${t.id}" class="mr-2 text-green-300 hover:text-green-200">Imprimer</button>
        ${(t.status || '').toLowerCase() === 'pending'
                        ? `<button data-action="void" data-id="${t.id}" class="text-rose-300 hover:text-rose-200">Annuler</button>`
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

                // S'assurer que le roundId est à jour
                if (round.id) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = round.id;
                }

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

        /* -------------------------
           Progress Bar Timer (identique à screen.html)
        ------------------------- */
        const mettreAJourProgressBar = () => {
            const now = Date.now();
            const timeLeft = this.timerTargetEndTime - now;
            const progressBar = el('progressBar');
            const timeDisplay = el('timeRemainingDisplay');

            if (!progressBar || !timeDisplay) return;

            if (timeLeft <= 0) {
                // Temps écoulé
                if (this.timerCountdownInterval) {
                    clearInterval(this.timerCountdownInterval);
                    this.timerCountdownInterval = null;
                }
                timeDisplay.textContent = '00:00';
                progressBar.style.width = '100%';
                progressBar.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500');
                progressBar.classList.add('bg-green-500');
                return;
            }

            // Calcul du pourcentage de progression (pourcentage écoulé)
            const elapsedTime = this.timerTotalDelayMs - timeLeft;
            const progressPercent = Math.min(100, (elapsedTime / this.timerTotalDelayMs) * 100);

            // Mise à jour de l'UI avec format 00:00 (MM:SS)
            const secondsLeft = Math.ceil(timeLeft / 1000);
            const minutes = Math.floor(secondsLeft / 60);
            const seconds = secondsLeft % 60;
            const timeDisplayStr = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
            
            timeDisplay.textContent = timeDisplayStr;
            progressBar.style.width = progressPercent + '%';

            // Changement de couleur dynamique (vert -> jaune -> rouge)
            progressBar.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500');
            if (progressPercent < 30) {
                progressBar.classList.add('bg-green-500');
            } else if (progressPercent < 80) {
                progressBar.classList.add('bg-yellow-500');
            } else {
                progressBar.classList.add('bg-red-500');
            }
        };

        const demarrerTimer = (timeLeft, totalDuration) => {
            // Arrêter le timer précédent si actif
            if (this.timerCountdownInterval) {
                clearInterval(this.timerCountdownInterval);
                this.timerCountdownInterval = null;
            }

            // Mettre à jour les variables
            this.timerTotalDelayMs = totalDuration || 120000;
            this.timerTargetEndTime = Date.now() + (timeLeft || 0);

            // Mise à jour immédiate
            mettreAJourProgressBar();

            // Démarrer l'intervalle de mise à jour (toutes les 250ms comme screen.html)
            this.timerCountdownInterval = setInterval(() => {
                mettreAJourProgressBar();
            }, 250);
        };

        const arreterTimer = () => {
            if (this.timerCountdownInterval) {
                clearInterval(this.timerCountdownInterval);
                this.timerCountdownInterval = null;
            }
            const progressBar = el('progressBar');
            const timeDisplay = el('timeRemainingDisplay');
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.classList.remove('bg-green-500', 'bg-yellow-500', 'bg-red-500');
            }
            if (timeDisplay) timeDisplay.textContent = '00:00';
        };

        // Stocker les fonctions pour utilisation par WebSocket
        this.dashboardRefreshTickets = refreshTickets;
        this.dashboardUpdateStats = updateStats;
        this.dashboardDemarrerTimer = demarrerTimer;
        this.dashboardArreterTimer = arreterTimer;
        this.dashboardMettreAJourProgressBar = mettreAJourProgressBar;

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
        const winRateEl = document.getElementById('myWinRate');
        const pendingPaymentsEl = document.getElementById('myPendingPayments');
        const paidWinningsEl = document.getElementById('myPaidWinnings');
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
            if (totalBetAmountEl) totalBetAmountEl.textContent = `${(stats.totalBetAmount || 0).toFixed(2)} HTG`;
            if (potentialWinningsEl) potentialWinningsEl.textContent = `${(stats.potentialWinnings || 0).toFixed(2)} HTG`;
            if (winRateEl) winRateEl.textContent = `${stats.winRate || 0}%`;
            if (pendingPaymentsEl) pendingPaymentsEl.textContent = `${(stats.pendingPayments || 0).toFixed(2)} HTG`;
            if (paidWinningsEl) paidWinningsEl.textContent = `${(stats.paidWinnings || 0).toFixed(2)} HTG`;
        }

        function updateTable(tickets) {
            ticketsTableBody.innerHTML = '';
            if (!tickets || tickets.length === 0) {
                ticketsTableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">Aucun ticket trouvé</td></tr>`;
                return;
            }

            tickets.forEach(t => {
                const hasPrize = t.prize && t.prize > 0;
                const isRoundFinished = t.isRoundFinished !== undefined ? t.isRoundFinished : false;
                const canCancel = t.status === 'pending' && !isRoundFinished && t.isInCurrentRound;
                
                ticketsTableBody.innerHTML += `
                <tr class="hover:bg-slate-700/50">
                    <td class="p-2 text-sm font-medium">#${t.id}</td>
                    <td class="p-2 text-sm text-slate-300">${formatDate(t.date)}</td>
                    <td class="p-2 text-sm text-slate-300">Course #${t.roundId}</td>
                    <td class="p-2 text-sm font-semibold">${t.totalAmount.toFixed(2)} HTG</td>
                    <td class="p-2 text-sm text-slate-300">x${t.avgCoeff.toFixed(2)}</td>
                    <td class="p-2 text-sm ${hasPrize ? 'text-green-400 font-bold' : 'text-slate-400'}">
                        ${hasPrize ? `${t.prize.toFixed(2)} HTG` : '-'}
                    </td>
                    <td class="p-2">
                        ${formatStatus(t.status)}
                    </td>
                    <td class="p-2 flex gap-2">
                        <!-- Bouton imprimer ticket (toujours visible) -->
                        <button class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded" 
                            onclick="window.open('/api/v1/receipts/?action=print&id=${t.id}', '_blank')"
                            title="Imprimer le ticket">
                            🖨️
                        </button>
                        
                        <!-- Bouton imprimer décaissement (visible pour tickets perdus après fin du round, ou tous les tickets terminés) -->
                        ${(t.status === 'lost' && isRoundFinished) || (t.status === 'won' || t.status === 'paid') ? `
                            <button class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-xs rounded" 
                                onclick="window.open('/api/v1/receipts/?action=payout&id=${t.id}', '_blank')"
                                title="Imprimer le décaissement">
                                💰
                            </button>` : ''}
                        
                        <!-- Bouton annuler (seulement si round pas terminé) -->
                        ${canCancel ? `
                            <button class="px-2 py-1 bg-red-600 hover:bg-red-700 text-xs rounded" 
                                onclick="window.cancelTicket && window.cancelTicket(${t.id})"
                                title="Annuler le ticket">
                                ❌
                            </button>` : ''}
                        
                        <!-- Bouton payer (visible pour tous les tickets gagnants, même si prize = 0) -->
                        ${t.status === 'won' ? `
                            <button class="px-2 py-1 bg-green-600 hover:bg-green-700 text-xs rounded" 
                                onclick="window.payTicket && window.payTicket(${t.id})"
                                title="Payer le ticket">
                                💵
                            </button>` : ''}
                        
                        <!-- Indicateur payé -->
                        ${t.status === 'paid' ? `
                            <span class="px-2 py-1 bg-blue-500/30 text-blue-300 text-xs rounded" title="Payé le ${t.paidAt ? formatDate(t.paidAt) : 'N/A'}">
                                ✓ Payé
                            </span>` : ''}
                    </td>
                </tr>
            `;
            });
        }

        // Fonction payTicket accessible globalement
        async function payTicket(id) {
            if (!confirm(`Confirmer le paiement du ticket #${id} ?\n\nLe décaissement sera imprimé, puis le ticket sera marqué comme payé.`)) return;
            
            try {
                // 1. Ouvrir la fenêtre d'impression du décaissement
                const payoutWindow = window.open(`/api/v1/receipts/?action=payout&id=${id}`, '_blank', 'width=800,height=600');
                
                // Attendre un court délai pour que la fenêtre se charge
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // 2. Effectuer le paiement
                const res = await fetch(`/api/v1/my-bets/pay/${id}`, { method: 'POST' });
                const data = await res.json();
                
                if (!res.ok) {
                    // Fermer la fenêtre d'impression si le paiement échoue
                    if (payoutWindow) payoutWindow.close();
                    throw new Error(data.error || data.message || "Erreur lors du paiement");
                }
                
                // 3. Rafraîchir la liste des tickets pour mettre à jour le statut
                fetchMyBets(currentPage);
                
                // 4. Message de confirmation
                alert(`✅ Ticket #${id} payé avec succès (${data.data?.prize?.toFixed(2) || 'N/A'} HTG).\n\nLe décaissement a été ouvert dans une nouvelle fenêtre pour impression.`);
                
            } catch (e) {
                alert(`❌ ${e.message}`);
            }
        }

        // Fonction cancelTicket accessible globalement
        async function cancelTicket(id) {
            if (!confirm(`Confirmer l'annulation du ticket #${id} ?`)) return;
            try {
                const res = await fetch(`/api/v1/receipts/?action=delete&id=${id}`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.message || "Erreur lors de l'annulation");
                alert(`✅ Ticket #${id} annulé avec succès.`);
                fetchMyBets(currentPage);
            } catch (e) {
                alert(`❌ ${e.message || 'Impossible d\'annuler ce ticket. Le round est peut-être déjà terminé.'}`);
            }
        }

        // Rendre les fonctions accessibles globalement pour les onclick inline
        window.payTicket = payTicket;
        window.cancelTicket = cancelTicket;

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
            const statusLabels = {
                pending: "En attente",
                won: "Gagné",
                lost: "Perdu",
                paid: "Payé",
                cancelled: "Annulé"
            };
            const map = {
                pending: "bg-yellow-500/20 text-yellow-400",
                won: "bg-green-500/20 text-green-400",
                lost: "bg-red-500/20 text-red-400",
                paid: "bg-blue-500/20 text-blue-400",
                cancelled: "bg-slate-500/20 text-slate-400"
            };
            const label = statusLabels[status] || status;
            return `<span class="${base} ${map[status] || 'bg-slate-600 text-slate-300'}">${label}</span>`;
        }

        // === Événements ===
        refreshButton.addEventListener("click", () => fetchMyBets(1));
        prevPageBtn.addEventListener("click", () => currentPage > 1 && fetchMyBets(currentPage - 1));
        nextPageBtn.addEventListener("click", () => currentPage < totalPages && fetchMyBets(currentPage + 1));
        
        // Filtres
        dateFilter.addEventListener("change", () => fetchMyBets(1));
        statusFilter.addEventListener("change", () => fetchMyBets(1));
        searchIdInput.addEventListener("input", debounce(() => fetchMyBets(1), 500));
        
        // Fonction debounce pour la recherche
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

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
                // Mettre à jour le round actuel immédiatement
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                    if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${data.roundId}`;
                }
                // Synchroniser le timer si disponible
                if (this.currentPage === 'dashboard' && data.timerTimeLeft && data.timerTimeLeft > 0) {
                    const totalDuration = data.timerTotalDuration || 120000;
                    if (this.dashboardDemarrerTimer) {
                        this.dashboardDemarrerTimer(data.timerTimeLeft, totalDuration);
                    }
                }
                // Synchroniser l'état de la course si elle est en cours
                if (this.currentPage === 'dashboard' && data.isRaceRunning && data.raceStartTime) {
                    this.showRaceOverlay(data.raceStartTime);
                    // Arrêter le timer pendant la course
                    if (this.dashboardArreterTimer) {
                        this.dashboardArreterTimer();
                    }
                } else if (this.currentPage === 'dashboard') {
                    this.hideRaceOverlay();
                }
                // Rafraîchir immédiatement pour avoir les données à jour
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    setTimeout(() => this.dashboardRefreshTickets(), 100);
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    setTimeout(() => this.myBetsFetchMyBets(1), 100);
                }
                break;

            case 'new_round':
                console.log('🆕 Nouveau tour:', data.roundId || data.game?.id);
                const newRoundId = data.roundId || data.game?.id || data.currentRound?.id;
                // Cacher l'overlay de course
                if (this.currentPage === 'dashboard') {
                    this.hideRaceOverlay();
                }
                // Mettre à jour le round actuel immédiatement
                const currentRoundEl = document.getElementById('currentRound');
                const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                if (currentRoundEl && newRoundId) {
                    currentRoundEl.textContent = newRoundId;
                }
                if (currentRoundTimerEl && newRoundId) {
                    currentRoundTimerEl.textContent = `Round ${newRoundId}`;
                }
                // Démarrer le timer si disponible dans les données
                if (this.currentPage === 'dashboard' && data.timer && data.timer.timeLeft > 0) {
                    if (this.dashboardDemarrerTimer) {
                        this.dashboardDemarrerTimer(data.timer.timeLeft, data.timer.totalDuration || 120000);
                    }
                } else if (this.currentPage === 'dashboard' && data.nextRoundStartTime) {
                    // Calculer le temps restant depuis nextRoundStartTime
                    const timeLeft = Math.max(0, data.nextRoundStartTime - Date.now());
                    if (timeLeft > 0 && this.dashboardDemarrerTimer) {
                        const totalDuration = data.timer?.totalDuration || 120000;
                        this.dashboardDemarrerTimer(timeLeft, totalDuration);
                    }
                }
                // Rafraîchir les données avec un petit délai pour laisser le serveur finaliser
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    setTimeout(() => this.dashboardRefreshTickets(), 300);
                }
                // Les tickets en attente restent valides mais sont liés à l'ancien round
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    setTimeout(() => this.myBetsFetchMyBets(1), 300);
                }
                // Notification
                this.showToast(`🆕 Nouveau round #${newRoundId}`, 'success');
                break;

            case 'race_start':
                console.log('🏁 Course démarrée - Round:', data.roundId);
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                    if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${data.roundId}`;
                }
                // Arrêter le timer pendant la course
                if (this.currentPage === 'dashboard' && this.dashboardArreterTimer) {
                    this.dashboardArreterTimer();
                }
                // Afficher l'overlay de course si on est sur le dashboard
                if (this.currentPage === 'dashboard') {
                    this.showRaceOverlay(data.raceStartTime || Date.now());
                }
                // Notification
                this.showToast(`🏁 Course démarrée - Round #${data.roundId || 'N/A'}`, 'info');
                break;

            case 'race_end':
                console.log('🏆 Course terminée - Round:', data.roundId, 'Gagnant:', data.winner);
                // Cacher l'overlay de course
                if (this.currentPage === 'dashboard') {
                    this.hideRaceOverlay();
                }
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                // Rafraîchir immédiatement pour voir les résultats
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    setTimeout(() => this.dashboardRefreshTickets(), 800); // Délai pour laisser le serveur finaliser les calculs
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    setTimeout(() => this.myBetsFetchMyBets(1), 800);
                }
                // Notification avec plus d'infos
                const winnerInfo = data.winner ? `${data.winner.name} (N°${data.winner.number})` : 'N/A';
                const totalPrize = data.totalPrize || data.prize || 0;
                this.showToast(`🏆 Round #${data.roundId || 'N/A'} terminé ! Gagnant: ${winnerInfo} | Total gains: ${totalPrize.toFixed(2)} HTG`, 'success');
                break;

            case 'ticket_update':
            case 'receipt_added':
            case 'receipt_deleted':
            case 'receipt_paid':
                console.log('🎫 Mise à jour des tickets - Round:', data.roundId, 'Événement:', data.event);
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                // Rafraîchir les données immédiatement
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    setTimeout(() => this.dashboardRefreshTickets(), 200);
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    setTimeout(() => this.myBetsFetchMyBets(1), 200);
                }
                // Notification spéciale pour les paiements
                if (data.event === 'receipt_paid') {
                    this.showToast(`💰 Ticket #${data.receiptId} payé (${data.prize?.toFixed(2) || 'N/A'} HTG) - Round #${data.roundId || 'N/A'}`, 'success');
                }
                break;

            default:
                console.log('📨 Événement WebSocket non géré:', data.event);
        }
    }

    showRaceOverlay(raceStartTime) {
        const overlay = document.getElementById('raceOverlay');
        if (!overlay) return;

        overlay.classList.remove('hidden');
        overlay.style.pointerEvents = 'auto';

        // Désactiver les interactions dans le dashboard
        const dashboardContent = document.getElementById('page-dashboard');
        if (dashboardContent) {
            dashboardContent.style.pointerEvents = 'none';
            dashboardContent.style.opacity = '0.6';
        }

        // Timer pour afficher le temps écoulé
        const MOVIE_SCREEN_DURATION_MS = 20000; // 20 secondes
        const FINISH_DURATION_MS = 5000; // 5 secondes
        const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_DURATION_MS;

        const timerEl = document.getElementById('raceTimer');
        if (!timerEl) return;

        let animationFrameId;
        function updateTimer() {
            const now = Date.now();
            const elapsed = (now - raceStartTime) / 1000;
            const remaining = Math.max(0, (TOTAL_RACE_TIME_MS / 1000) - elapsed);

            if (remaining > 0 && overlay && !overlay.classList.contains('hidden')) {
                timerEl.textContent = Math.ceil(remaining) + 's';
                animationFrameId = requestAnimationFrame(updateTimer);
            } else {
                timerEl.textContent = 'Fin imminente...';
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
            }
        }

        // Stocker l'animation frame pour pouvoir l'annuler
        this.raceTimerAnimation = updateTimer;
        updateTimer();
    }

    hideRaceOverlay() {
        const overlay = document.getElementById('raceOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.pointerEvents = 'none';
        }

        // Réactiver les interactions dans le dashboard
        const dashboardContent = document.getElementById('page-dashboard');
        if (dashboardContent) {
            dashboardContent.style.pointerEvents = 'auto';
            dashboardContent.style.opacity = '1';
        }

        const timerEl = document.getElementById('raceTimer');
        if (timerEl) {
            timerEl.textContent = '--s';
        }

        // Annuler l'animation du timer
        if (this.raceTimerAnimation) {
            cancelAnimationFrame(this.raceTimerAnimation);
            this.raceTimerAnimation = null;
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