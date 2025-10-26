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
        
        switch(pageId) {
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
        // Rafraîchir les tickets du dashboard
        if (typeof refreshTickets === 'function') {
            refreshTickets();
        }
        
        // Configurer les événements spécifiques au dashboard
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                if (typeof refreshTickets === 'function') {
                    refreshTickets();
                }
            });
        }
    }

    initCourseChevaux() {
        // Initialiser la page Course Chevaux
        console.log('Initialisation de la page Course Chevaux');
        // Le jeu devrait s'initialiser automatiquement via les scripts existants
    }

    initMyBets() {
        // Initialiser la page Mes Paris
        console.log('Initialisation de la page Mes Paris');
        // === INITIALISATION DE LA PAGE ===
            console.log("%c[INIT] Chargement de la page Mes Paris...", "color: #3b82f6");

            const API_URL = '/api/v1/my-bets/';
            let currentPage = 1;
            let totalPages = 1;

            // Sélecteurs DOM
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

            // === Fonctions principales ===
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
                            <td class="p-2">
                                <button class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded" onclick="window.open('/api/v1/receipts/?action=print&id=${t.id}', '_blank')">
                                    Détails
                                </button>
                            </td>
                        </tr>
                    `;
                });
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

            // Chargement initial
            fetchMyBets(1);
        
    
        
        const refreshMyBetsBtn = document.getElementById('refreshMyBets');
        if (refreshMyBetsBtn) {
            refreshMyBetsBtn.addEventListener('click', () => {
                // Implémenter le rafraîchissement des paris personnels
                this.showToast('Mes paris rafraîchis', 'success');
            });
        }
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

    init() {
        this.setupEventListeners();
        this.loadPage('dashboard');
        
        // Initialiser WebSocket si la fonction existe
        if (typeof connectWebSocket === 'function') {
            connectWebSocket();
        }
    }
}

// Initialiser l'application quand le DOM est chargé
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});