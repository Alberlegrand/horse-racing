class App {
    // Fonction utilitaire pour formater les statuts
    formatStatus(status) {
        const statusMap = {
            'pending': '<span class="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full text-xs">En attente</span>',
            'won': '<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full text-xs">Gagné</span>',
            'paid': '<span class="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full text-xs">Payé</span>',
            'lost': '<span class="bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full text-xs">Perdu</span>',
            'cancelled': '<span class="bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full text-xs">Annulé</span>'
        };
        return statusMap[status] || status;
    }

    constructor() {
        this.currentPage = 'dashboard';
        this.isRaceRunning = false; // État de la course pour contrôler les boutons d'annulation
        this.pages = {
            // Use absolute paths to avoid relative-fetch issues when the app is loaded
            // from a nested route (e.g. /dashboard). Leading slash ensures fetch() hits
            // the server root: /pages/...
            'dashboard': '/pages/dashboard.html',
            'course-chevaux': '/pages/course-chevaux.html',
            'betting': '/pages/betting.html',
            'my-bets': '/pages/my-bets.html',
            'account': '/pages/account.html'
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

            // Attendre que le DOM soit prêt avant d'initialiser les composants
            // Cela permet aux scripts dans dashboard.html de se charger et aux éléments DOM d'être disponibles
            await new Promise(resolve => {
                // Utiliser requestAnimationFrame pour s'assurer que le DOM est rendu
                requestAnimationFrame(() => {
                    // Petit délai supplémentaire pour laisser les scripts se charger
                    setTimeout(resolve, 50);
                });
            });

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

        // IMPORTANT: Nettoyer l'ancien intervalle AVANT de réinitialiser
        // pour éviter les fuites mémoire et les conflits
        if (this.timerCountdownInterval) {
            clearInterval(this.timerCountdownInterval);
            this.timerCountdownInterval = null;
        }

        // Références aux fonctions de refresh pour WebSocket
        this.dashboardRefreshTickets = null;
        this.dashboardUpdateStats = null;

        // Variables pour le timer de lancement (identique à screen.html)
        this.timerTotalDelayMs = 180000; // 2 minutes par défaut
        this.timerTargetEndTime = 0; // Timestamp exact de la fin du compte à rebours
        this.timerCountdownInterval = null; // ID de l'intervalle pour la mise à jour de la barre

        // Helper function
        const el = (id) => document.getElementById(id);

        /* -------------------------
           Formatage du statut
        ------------------------- */
        const formatStatus = (status) => {
            const base = "px-2 py-0.5 rounded-full text-xs font-medium";
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
        };

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
                const roundId = t.roundId || '-';
                const createdTime = t.date || t.created_time || t.created_at || Date.now();
                const total = (t.totalAmount || 0).toFixed(2);
                const isMultibet = Array.isArray(t.bets) && t.bets.length > 1;
                // For single bets, show the participant coeff; for multibets, show a compact label
                const coeffLabel = isMultibet ? `Multibet (${t.bets.length})` : (t.bets && t.bets[0] && t.bets[0].participant ? `x${Number(t.bets[0].participant.coeff).toFixed(2)}` : (t.avgCoeff ? `x${Number(t.avgCoeff).toFixed(2)}` : '-'));
                const hasPrize = t.prize && t.prize > 0;
                // Permettre l'annulation tant que le statut est "pending"
                const canCancel = t.status === 'pending';
                
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-700/50';
                tr.innerHTML = `
                    <td class="p-2 text-sm font-medium">#${t.id}</td>
                    <td class="p-2 text-slate-400 text-xs">${new Date(createdTime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td class="p-2 text-sm text-slate-300">#${roundId}</td>
                    <td class="p-2 text-sm font-semibold text-green-300">${total} HTG</td>
                    <td class="p-2 text-sm text-slate-300">${coeffLabel}</td>
                    <td class="p-2">${this.formatStatus(t.status || 'pending')}</td>
                    <td class="p-2">
                        <div class="flex gap-1 flex-wrap">
                            <button data-action="print" data-id="${t.id}" 
                                class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded text-white" 
                                title="Imprimer">🖨️</button>
                            ${canCancel
                                ? `<button data-action="void" data-id="${t.id}" 
                                    class="px-2 py-1 bg-red-600 hover:bg-red-700 text-xs rounded text-white" 
                                    title="Annuler">❌</button>`
                                : ''}
                            ${t.status === 'won'
                                ? `<button data-action="pay" data-id="${t.id}" 
                                    class="px-2 py-1 bg-green-600 hover:bg-green-700 text-xs rounded text-white" 
                                    title="Payer le ticket">💵</button>`
                                : ''}
                            ${t.status === 'paid'
                                ? `<span class="px-2 py-1 bg-blue-500/30 text-blue-300 text-xs rounded" 
                                    title="Payé le ${t.paidAt ? new Date(t.paidAt).toLocaleString('fr-FR') : 'N/A'}">✓ Payé</span>`
                                : ''}
                            <button data-action="rebet" data-id="${t.id}" 
                                class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-xs rounded text-white" 
                                title="Rejouer ce ticket">🔄</button>
                        </div>
                    </td>
                `;
                table.appendChild(tr);
            });
        }

        /* -------------------------
           Fonction rebet
        ------------------------- */
        const rebetTicket = async (ticketId) => {
            try {
                // Récupérer le ticket original avec ses bets
                const ticketRes = await fetch(`/api/v1/my-bets/${ticketId}`);
                if (!ticketRes.ok) throw new Error('Ticket non trouvé');
                const ticketData = await ticketRes.json();
                const originalTicket = ticketData?.data;
                if (!originalTicket || !originalTicket.bets || originalTicket.bets.length === 0) {
                    throw new Error('Ticket invalide ou sans paris');
                }
                
                // Récupérer le round actuel pour obtenir les participants
                const roundRes = await fetch('/api/v1/rounds/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get' })
                });
                if (!roundRes.ok) throw new Error('Impossible de récupérer le round actuel');
                const roundData = await roundRes.json();
                const currentRound = roundData?.data || {};
                const participants = currentRound.participants || [];
                
                // Vérifier si une course est en cours
                if (currentRound.isRaceRunning) {
                    throw new Error('Impossible de rejouer : une course est en cours');
                }
                
                // Reconstruire les bets avec les participants actuels
                const newBets = [];
                for (const originalBet of originalTicket.bets) {
                    // Trouver le participant actuel avec le même numéro
                    const betNumber = originalBet.number || originalBet.participant?.number;
                    const currentParticipant = participants.find(p => p.number === betNumber);
                    if (currentParticipant) {
                        // Conserver la valeur originale (en système)
                        const betValue = originalBet.value || 0;
                        newBets.push({
                            participant: currentParticipant,
                            number: currentParticipant.number,
                            value: betValue
                        });
                    }
                }
                
                if (newBets.length === 0) {
                    throw new Error('Aucun participant correspondant trouvé dans le round actuel');
                }
                
                // Créer le nouveau ticket
                const receiptData = {
                    bets: newBets
                };
                
                const addRes = await fetch('/api/v1/receipts/?action=add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(receiptData)
                });
                
                if (!addRes.ok) {
                    const errorData = await addRes.json();
                    throw new Error(errorData.error || 'Erreur lors de la création du ticket');
                }
                
                const addData = await addRes.json();
                this.showToast(`✅ Ticket #${addData.data.id} créé avec succès (rebet de #${ticketId})`, 'success');
                
                // Rafraîchir la liste
                refreshTickets();
                
            } catch (err) {
                console.error('Erreur rebet:', err);
                this.showToast(err.message || 'Erreur lors du rebet', 'error');
            }
        };
        
    // Rendre la fonction accessible globalement (délègue vers App)
    window.rebetTicket = (id) => this.rebetTicket(id);

        /* -------------------------
           Fonction payTicket pour le dashboard
        ------------------------- */
        const payTicket = async (ticketId) => {
            this.confirmModal(
                `Confirmer le paiement du ticket #${ticketId} ?<br><br>Le décaissement sera imprimé, puis le ticket sera marqué comme payé.`,
                async () => {
                    try {
                        // 1. Ouvrir la fenêtre d'impression du décaissement
                        //const payoutWindow = window.open(`/api/v1/receipts/?action=payout&id=${ticketId}`, '_blank', 'width=800,height=600');
                        
                        // Attendre un court délai pour que la fenêtre se charge
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // 2. Effectuer le paiement
                        const res = await fetch(`/api/v1/my-bets/pay/${ticketId}`, { method: 'POST' });
                        const data = await res.json();
                        
                        if (!res.ok) {
                            throw new Error(data.error || data.message || "Erreur lors du paiement");
                        }
                        
                        // 3. Rafraîchir la liste des tickets pour mettre à jour le statut
                        refreshTickets();
                        
                        // 4. Message de confirmation
                        this.alertModal(
                            `✅ Ticket #${ticketId} payé avec succès (${data.data?.prize?.toFixed(2) || 'N/A'} HTG)`,
                            'success'
                        );
                        
                    } catch (err) {
                        console.error('Erreur payTicket:', err);
                        this.alertModal(err.message || 'Erreur lors du paiement', 'error');
                    }
                } // end confirmModal callback
            ); // end confirmModal
        }; // end payTicket

        /* -------------------------
           Fonction cancelTicket pour le dashboard
        ------------------------- */
        const cancelTicket = async (ticketId) => {
            this.confirmModal(
                `Confirmer l'annulation du ticket #${ticketId} ?`,
                async () => {
                    try {
                        const res = await fetch(`/api/v1/receipts/?action=delete&id=${ticketId}`, { method: 'POST' });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || data.message || "Erreur lors de l'annulation");
                        
                        this.alertModal(`✅ Ticket #${ticketId} annulé avec succès`, 'success', () => {
                            // Rafraîchir la liste des tickets pour mettre à jour le statut
                            refreshTickets();
                        });
                        
                    } catch (err) {
                        console.error('Erreur cancelTicket:', err);
                        this.alertModal(
                            err.message || 'Impossible d\'annuler ce ticket. La course est peut-être déjà terminée avec résultats.',
                            'error'
                        );
                    }
                }
            );
        };

    // Rendre les fonctions accessibles globalement
    window.payTicket = payTicket;
    window.cancelTicket = (id) => this.cancelTicket(id);

        /* -------------------------
           Rafraîchissement
        ------------------------- */
        const refreshTickets = async () => {
            try {
                // Charger les 10 derniers tickets via my-bets API
                const res = await fetch('/api/v1/my-bets/?limit=10&page=1');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const tickets = data?.data?.tickets || [];
                const stats = data?.data?.stats || {};

                // Mettre à jour le round actuel depuis l'API rounds
                const roundRes = await fetch('/api/v1/rounds/', { 
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json' 
                    },
                    body: JSON.stringify({ action: 'get' })
                });
                if (roundRes.ok) {
                    const roundData = await roundRes.json();
                    const round = roundData?.data || {};
                    if (round.id) {
                        const currentRoundEl = document.getElementById('currentRound');
                        if (currentRoundEl) currentRoundEl.textContent = round.id;
                    }
                    // Mettre à jour les stats avec les données du round
                    updateStats(round, stats);
                }

                updateTicketsTable(tickets);
            } catch (err) {
                console.error('Erreur refreshTickets:', err);
                this.showToast('Erreur de connexion à l\'API.', 'error');
            }
        };

        // Fonction pour synchroniser le timer depuis le serveur
        const synchroniserTimer = async () => {
            try {
                const res = await fetch('/api/v1/rounds/status', { 
                    method: 'GET',
                    headers: { 
                        'Accept': 'application/json' 
                    }
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                
                console.log('📊 État serveur récupéré:', data);

                // Mettre à jour le round actuel si disponible
                if (data.currentRound && data.currentRound.id) {
                    const currentRoundEl = document.getElementById('currentRound');
                    const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                    if (currentRoundEl) currentRoundEl.textContent = data.currentRound.id;
                    if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${data.currentRound.id}`;
                }

                // Attendre que dashboardDemarrerTimer soit disponible
                if (!this.dashboardDemarrerTimer) {
                    console.warn('⚠️ dashboardDemarrerTimer non encore disponible, réessai dans 100ms...');
                    setTimeout(() => synchroniserTimer(), 100);
                    return;
                }

                // Synchroniser le timer si un timer est actif
                if (data.timerTimeLeft && data.timerTimeLeft > 0) {
                    console.log('⏰ Synchronisation du timer depuis le serveur:', {
                        timeLeft: data.timerTimeLeft,
                        totalDuration: data.timerTotalDuration
                    });
                    this.dashboardDemarrerTimer(data.timerTimeLeft, data.timerTotalDuration || 180000);
                } else if (data.nextRoundStartTime) {
                    // Calculer le temps restant depuis nextRoundStartTime
                    const timeLeft = Math.max(0, data.nextRoundStartTime - Date.now());
                    if (timeLeft > 0) {
                        console.log('⏰ Synchronisation du timer depuis nextRoundStartTime:', {
                            timeLeft,
                            totalDuration: data.timerTotalDuration
                        });
                        this.dashboardDemarrerTimer(timeLeft, data.timerTotalDuration || 180000);
                    }
                } else if (data.isRaceRunning) {
                    // Si une course est en cours, arrêter le timer
                    if (this.dashboardArreterTimer) {
                        this.dashboardArreterTimer();
                    }
                }
            } catch (err) {
                console.error('Erreur synchroniserTimer:', err);
                // Ne pas afficher de toast pour cette erreur, c'est silencieux
            }
        };

        const updateStats = (round, myBetsStats) => {
            // Utiliser les stats de my-bets si disponibles, sinon calculer depuis le round
            let total = 0;
            let activeCount = 0;
            
            if (myBetsStats) {
                total = myBetsStats.totalBetAmount || 0;
                activeCount = myBetsStats.activeTicketsCount || 0;
            } else {
                const receipts = round?.receipts || [];
                // Les valeurs bet.value sont en système, convertir en publique pour l'affichage
                total = receipts.reduce((sum, r) => {
                    const receiptsSum = (r.bets || []).reduce((s, b) => {
                        const valueSystem = Number(b.value || 0);
                        const valuePublic = Currency.systemToPublic(valueSystem);
                        return s + valuePublic;
                    }, 0);
                    return sum + receiptsSum;
                }, 0);
                activeCount = receipts.length;
            }

            // lookup DOM elements lazily (page injectée dynamiquement par App)
            const totalBetsAmountEl = document.getElementById('totalBetsAmount');
            const activeTicketsCountEl = document.getElementById('activeTicketsCount');
            const currentRoundEl = document.getElementById('currentRound');

            if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(2)} HTG`;
            if (activeTicketsCountEl) activeTicketsCountEl.textContent = activeCount;
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

            // Vérifier que les éléments DOM sont disponibles
            const progressBar = el('progressBar');
            const timeDisplay = el('timeRemainingDisplay');
            if (!progressBar || !timeDisplay) {
                console.warn('⚠️ Éléments DOM du timer non disponibles, réessai dans 100ms...');
                // Réessayer après un court délai pour laisser le DOM se charger
                setTimeout(() => {
                    demarrerTimer(timeLeft, totalDuration);
                }, 100);
                return;
            }

            // Mettre à jour les variables
            this.timerTotalDelayMs = totalDuration || 180000;
            this.timerTargetEndTime = Date.now() + (timeLeft || 0);

            // Mise à jour immédiate
            mettreAJourProgressBar();

            // Démarrer l'intervalle de mise à jour (toutes les 250ms comme screen.html)
            this.timerCountdownInterval = setInterval(() => {
                mettreAJourProgressBar();
            }, 250);
            
            console.log('✅ Timer démarré:', { timeLeft, totalDuration, targetEndTime: this.timerTargetEndTime });
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
        this.dashboardSynchroniserTimer = synchroniserTimer;

        // Rafraîchir immédiatement
        refreshTickets();

        // Synchroniser le timer depuis le serveur après un court délai
        // pour s'assurer que les éléments DOM sont disponibles
        setTimeout(() => {
            synchroniserTimer();
        }, 200);

        // Configurer le bouton de rafraîchissement
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshTickets();
                synchroniserTimer();
            });
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
        
        // Fonction de mise à jour de la table des tickets
        const updateTicketsTable = (tickets) => {
            if (!ticketsTableBody) return;
            
            if (!tickets || tickets.length === 0) {
                ticketsTableBody.innerHTML = `
                    <tr>
                        <td colspan="8" class="p-4 text-center text-slate-400">Aucun ticket trouvé</td>
                    </tr>
                `;
                return;
            }

            ticketsTableBody.innerHTML = tickets.map(ticket => `
                <tr class="hover:bg-slate-700/50">
                    <td class="p-2">${ticket.id}</td>
                    <td class="p-2">${new Date(ticket.date).toLocaleString('fr-FR')}</td>
                    <td class="p-2">${ticket.roundId}</td>
                    <td class="p-2">
                        ${ticket.isMultibet ? `
                            <div class="text-sm font-medium">Multibet (${ticket.bets.length} paris)</div>
                            <div class="text-xs text-slate-400 mt-1">Total: ${ticket.totalAmount.toFixed(2)} HTG</div>
                        ` : ticket.bets.map(bet => `
                            <div class="text-sm mb-1">
                                <span title="Participant">#${bet.participant.number} ${bet.participant.name}</span>
                                <span class="text-slate-400"> - </span>
                                <span title="Mise">${(parseFloat(bet.value)/100).toFixed(2)} HTG</span>
                                <span class="text-slate-400">×</span>
                                <span title="Cote">${bet.participant.coeff}x</span>
                                <span class="text-slate-400">=</span>
                                <span title="Gain potentiel">${((parseFloat(bet.value)/100) * bet.participant.coeff).toFixed(2)} HTG</span>
                            </div>
                        `).join('')}
                    </td>
                    <td class="p-2">${ticket.isMultibet ? `Multibet (${ticket.bets.length})` : `${ticket.avgCoeff.toFixed(2)}x`}</td>
                    <td class="p-2">${ticket.isMultibet ? '-' : `${ticket.potentialWinnings.toFixed(2)} HTG`}</td>
                    <td class="p-2">${this.formatStatus(ticket.status)}</td>
                    <td class="p-2">
                        <div class="flex items-center gap-2">
                <button onclick="window.printTicket && window.printTicket(${ticket.id})" 
                    class="p-1 hover:bg-slate-600 rounded" title="Imprimer">
                                🖨️
                            </button>
                            ${ticket.status === 'won' ? 
                                `<button onclick="payTicket(${ticket.id})" 
                                         class="p-1 hover:bg-slate-600 rounded" title="Payer">
                                    💰
                                </button>` : ''}
                            ${ticket.isInCurrentRound ? 
                                `<button onclick="cancelTicket(${ticket.id})" 
                                         class="p-1 hover:bg-slate-600 rounded" title="Annuler">
                                    ❌
                                </button>` : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        };

        // Fonction de récupération des tickets
        const fetchMyBets = async (page = 1) => {
            try {
                currentPage = page;
                const filters = new URLSearchParams({
                    page: currentPage.toString(),
                    limit: '10'
                });

                if (dateFilter.value) {
                    filters.append('date', dateFilter.value);
                }
                if (statusFilter.value) {
                    filters.append('status', statusFilter.value);
                }
                if (searchIdInput.value) {
                    filters.append('searchId', searchIdInput.value);
                }

                const response = await fetch(`${API_URL}?${filters.toString()}`);
                if (!response.ok) throw new Error('Erreur lors de la récupération des tickets');

                const payload = await response.json();
                // Some server endpoints return { data: {...} } without a 'success' flag.
                // Support both formats: { success: boolean, data: {...} } and { data: {...} }.
                if (typeof payload.success !== 'undefined' && payload.success === false) {
                    throw new Error(payload.error || 'Erreur inconnue');
                }

                const body = payload.data || payload;

                // Mise à jour de la pagination
                currentPage = body.pagination?.currentPage || currentPage;
                totalPages = body.pagination?.totalPages || totalPages;

                // Mise à jour des stats
                if (body.stats) {
                    totalBetAmountEl.textContent = `${(body.stats.totalBetAmount || 0).toFixed(2)} HTG`;
                    potentialWinningsEl.textContent = `${(body.stats.potentialWinnings || 0).toFixed(2)} HTG`;
                    pendingPaymentsEl.textContent = `${(body.stats.pendingPayments || 0).toFixed(2)} HTG`;
                    paidWinningsEl.textContent = `${(body.stats.paidWinnings || 0).toFixed(2)} HTG`;
                    winRateEl.textContent = `${body.stats.winRate || 0}%`;
                }

                // Mise à jour de l'interface de pagination
                displayedRangeEl.textContent = body.pagination?.displayedRange || displayedRangeEl.textContent;
                totalMyBetsEl.textContent = body.pagination?.totalItems ?? totalMyBetsEl.textContent;
                currentPageEl.textContent = `Page ${currentPage}`;
                
                // Activer/désactiver les boutons de pagination
                prevPageBtn.disabled = currentPage <= 1;
                nextPageBtn.disabled = currentPage >= totalPages;

                // Mise à jour de la table
                updateTicketsTable(body.tickets || []);
                
            } catch (error) {
                console.error('Erreur fetchMyBets:', error);
                this.showToast('Erreur lors de la récupération des tickets', 'error');
            }
        };

        

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
                // Permettre l'annulation tant que le statut est "pending"
                const canCancel = t.status === 'pending';
                
                ticketsTableBody.innerHTML += `
                <tr class="hover:bg-slate-700/50">
                    <td class="p-2 text-sm font-medium">#${t.id}</td>
                    <td class="p-2 text-sm text-slate-300">${formatDate(t.date)}</td>
                    <td class="p-2 text-sm text-slate-300">Course #${t.roundId}</td>
                    <td class="p-2 text-sm font-semibold">${t.totalAmount.toFixed(2)} HTG</td>
                    <td class="p-2 text-sm text-slate-300">${t.isMultibet ? `Multibet (${t.bets?.length || 0})` : (t.bets && t.bets[0] && t.bets[0].participant ? `x${Number(t.bets[0].participant.coeff).toFixed(2)}` : (t.avgCoeff ? `x${Number(t.avgCoeff).toFixed(2)}` : '-'))}</td>
                    <td class="p-2 text-sm ${hasPrize ? 'text-green-400 font-bold' : 'text-slate-400'}">
                        ${hasPrize ? `${t.prize.toFixed(2)} HTG` : '-'}
                    </td>
                    <td class="p-2">
                        ${this.formatStatus(t.status)}
                    </td>
                    <td class="p-2 flex gap-2">
                        <!-- Bouton imprimer ticket (toujours visible) -->
                        <button class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded" 
                            onclick="window.printTicket && window.printTicket(${t.id})"
                            title="Imprimer le ticket">
                            🖨️
                        </button>
                        
                        <!-- Bouton imprimer décaissement (visible pour tickets perdus après fin du round, ou tous les tickets terminés) -->
                        ${(t.status === 'lost' && isRoundFinished) || (t.status === 'won' || t.status === 'paid') ? `
                            <button class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-xs rounded" 
                                onclick="window.payTicket && window.payTicket(${t.id})"
                                title="Imprimer le décaissement & Payer">
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
            if (!window.app) {
                console.error('App instance non disponible');
                return;
            }
            
            window.app.confirmModal(
                `Confirmer le paiement du ticket #${id} ?<br><br>Le décaissement sera imprimé, puis le ticket sera marqué comme payé.`,
                async () => {
                    try {
                        // 1. Récupérer et imprimer le décaissement avec printJS
                        const payoutRes = await fetch(`/api/v1/receipts/?action=payout&id=${id}`);
                        const payoutHtml = await payoutRes.text();
                        printJS({ printable: payoutHtml, type: 'raw-html' });
                        
                        // 2. Effectuer le paiement
                        const payRes = await fetch(`/api/v1/my-bets/pay/${id}`, { method: 'POST' });
                        const data = await payRes.json();
                        
                        if (!payRes.ok) {
                            throw new Error(data.error || data.message || "Erreur lors du paiement");
                        }
                        
                        // 3. Rafraîchir la liste des tickets pour mettre à jour le statut
                        fetchMyBets(currentPage);
                        
                        // 4. Message de confirmation
                        window.app.alertModal(
                            `✅ Ticket #${id} payé avec succès (${data.data?.prize?.toFixed(2) || 'N/A'} HTG).<br><br>Le décaissement a été envoyé à l'imprimante.`,
                            'success'
                        );
                        
                    } catch (e) {
                        window.app.alertModal(`❌ ${e.message}`, 'error');
                    }
                }
            );
        }

        // Fonction cancelTicket accessible globalement
        async function cancelTicket(id) {
            if (!window.app) {
                console.error('App instance non disponible');
                return;
            }
            
            window.app.confirmModal(
                `Confirmer l'annulation du ticket #${id} ?`,
                async () => {
                    try {
                        const res = await fetch(`/api/v1/receipts/?action=delete&id=${id}`, { method: 'POST' });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || data.message || "Erreur lors de l'annulation");
                        
                        window.app.alertModal(
                            `✅ Ticket #${id} annulé avec succès.`,
                            'success',
                            () => {
                                fetchMyBets(currentPage);
                            }
                        );
                    } catch (e) {
                        window.app.alertModal(
                            `❌ ${e.message || 'Impossible d\'annuler ce ticket. La course est peut-être déjà terminée avec résultats.'}`,
                            'error'
                        );
                    }
                }
            );
        }

    // Rendre les fonctions accessibles globalement pour les onclick inline
    window.payTicket = payTicket;
    window.cancelTicket = (id) => this.cancelTicket(id);

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

            // Annuler (optionnel: un handler custom 'showVoidModal' peut être défini ailleurs)
            if (e.target.matches('[data-action="void"]') || e.target.closest('[data-action="void"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="void"]').dataset.id;
                if (typeof showVoidModal === 'function') {
                    // Si une fonction showVoidModal existe, déléguer et arrêter la propagation
                    showVoidModal(ticketId);
                    return;
                }
                // Sinon, laisser le gestionnaire global suivant prendre en charge (pas de return)
            }

            // Rebet
            if (e.target.matches('[data-action="rebet"]') || e.target.closest('[data-action="rebet"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="rebet"]').dataset.id;
                if (window.rebetTicket && typeof window.rebetTicket === 'function') {
                    window.rebetTicket(parseInt(ticketId, 10));
                }
                return;
            }

            // Payer (dashboard)
            if (e.target.matches('[data-action="pay"]') || e.target.closest('[data-action="pay"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="pay"]').dataset.id;
                if (window.payTicket && typeof window.payTicket === 'function') {
                    window.payTicket(parseInt(ticketId, 10));
                }
                return;
            }

            // Annuler (dashboard)
            if (e.target.matches('[data-action="void"]') || e.target.closest('[data-action="void"]')) {
                e.preventDefault();
                const ticketId = e.target.dataset.id || e.target.closest('[data-action="void"]').dataset.id;
                if (window.cancelTicket && typeof window.cancelTicket === 'function') {
                    window.cancelTicket(parseInt(ticketId, 10));
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
        if (!toastEl) return;
        
        const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

        toastEl.innerHTML = `<div class="${bgColor} text-white px-4 py-2 rounded shadow">${message}</div>`;
        toastEl.classList.remove('hidden');

        setTimeout(() => {
            toastEl.classList.add('hidden');
        }, 3000);
    }

    // Système de modal réutilisable
    showModal(options) {
        const {
            title = 'Confirmation',
            message = '',
            type = 'confirm', // 'confirm', 'alert', 'info'
            confirmText = 'Confirmer',
            cancelText = 'Annuler',
            onConfirm = null,
            onCancel = null,
            confirmColor = 'bg-blue-600 hover:bg-blue-700',
            cancelColor = 'bg-slate-700 hover:bg-slate-600'
        } = options;

        // Créer ou réutiliser le modal
        let modalEl = document.getElementById('appModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'appModal';
            modalEl.className = 'fixed inset-0 bg-black/60 hidden items-center justify-center z-50 flex';
            modalEl.innerHTML = `
                <div class="bg-slate-900 rounded-lg p-6 w-full max-w-md border border-slate-800 shadow-xl">
                    <h4 id="modalTitle" class="font-semibold text-lg mb-2"></h4>
                    <p id="modalMessage" class="text-sm text-slate-300 mb-6"></p>
                    <div id="modalButtons" class="flex justify-end gap-3"></div>
                </div>
            `;
            document.body.appendChild(modalEl);
        }

        // Remplir le contenu
        const titleEl = modalEl.querySelector('#modalTitle');
        const messageEl = modalEl.querySelector('#modalMessage');
        const buttonsEl = modalEl.querySelector('#modalButtons');

        titleEl.textContent = title;
        messageEl.innerHTML = message;

        // Configurer les boutons selon le type
        buttonsEl.innerHTML = '';
        
        if (type === 'alert' || type === 'info') {
            // Un seul bouton "OK"
            const okBtn = document.createElement('button');
            okBtn.className = `px-4 py-2 rounded-md text-white ${confirmColor}`;
            okBtn.textContent = 'OK';
            okBtn.onclick = () => {
                modalEl.classList.add('hidden');
                if (onConfirm) onConfirm();
            };
            buttonsEl.appendChild(okBtn);
        } else {
            // Deux boutons "Annuler" et "Confirmer"
            const cancelBtn = document.createElement('button');
            cancelBtn.className = `px-4 py-2 rounded-md text-white ${cancelColor}`;
            cancelBtn.textContent = cancelText;
            cancelBtn.onclick = () => {
                modalEl.classList.add('hidden');
                if (onCancel) onCancel();
            };
            buttonsEl.appendChild(cancelBtn);

            const confirmBtn = document.createElement('button');
            confirmBtn.className = `px-4 py-2 rounded-md text-white ${confirmColor}`;
            confirmBtn.textContent = confirmText;
            confirmBtn.onclick = () => {
                modalEl.classList.add('hidden');
                if (onConfirm) onConfirm();
            };
            buttonsEl.appendChild(confirmBtn);
        }

        // Fermer en cliquant sur le fond
        modalEl.onclick = (e) => {
            if (e.target === modalEl) {
                modalEl.classList.add('hidden');
                if (onCancel) onCancel();
            }
        };

        // Afficher le modal
        modalEl.classList.remove('hidden');
    }

    // Wrapper pour confirm()
    confirmModal(message, onConfirm, onCancel) {
        this.showModal({
            title: 'Confirmation',
            message: message,
            type: 'confirm',
            confirmText: 'Confirmer',
            cancelText: 'Annuler',
            confirmColor: 'bg-blue-600 hover:bg-blue-700',
            onConfirm: onConfirm,
            onCancel: onCancel || (() => {})
        });
    }

    // Wrapper pour alert()
    alertModal(message, type = 'info', onClose = null) {
        this.showModal({
            title: type === 'error' ? 'Erreur' : type === 'success' ? 'Succès' : 'Information',
            message: message,
            type: 'alert',
            confirmText: 'OK',
            confirmColor: type === 'error' ? 'bg-red-600 hover:bg-red-700' : 
                         type === 'success' ? 'bg-green-600 hover:bg-green-700' : 
                         'bg-blue-600 hover:bg-blue-700',
            onConfirm: onClose || (() => {})
        });
    }

        // Centralized cancel ticket method available across pages
        async cancelTicket(ticketId) {
            // Vérifier si la course est en cours
            if (this.isRaceRunning) {
                this.alertModal('⚠️ Impossible d\'annuler un ticket pendant une course.', 'error');
                return;
            }

            this.confirmModal(
                `Confirmer l'annulation du ticket #${ticketId} ?`,
                async () => {
                    try {
                        const res = await fetch(`/api/v1/receipts/?action=delete&id=${ticketId}`, { method: 'POST' });
                        let data = null;
                        try { data = await res.json(); } catch (e) { /* ignore */ }

                        if (!res.ok) {
                            const msg = data?.error || data?.message || `HTTP ${res.status}`;
                            this.alertModal(msg, 'error');
                            return;
                        }

                        this.alertModal(`✅ Ticket #${ticketId} annulé avec succès`, 'success');

                        // Refresh currently visible list if available
                        if (this.currentPage === 'dashboard' && typeof this.dashboardRefreshTickets === 'function') {
                            this.dashboardRefreshTickets();
                        }
                        if (this.currentPage === 'my-bets' && typeof this.myBetsFetchMyBets === 'function') {
                            this.myBetsFetchMyBets(1);
                        }
                    } catch (err) {
                        console.error('Erreur cancelTicket:', err);
                        this.alertModal(err.message || 'Impossible d\'annuler ce ticket.', 'error');
                    }
                }
            );
        }

        // Centralized rebet method available across pages
        async rebetTicket(ticketId) {
            try {
                // Récupérer le ticket original
                const ticketRes = await fetch(`/api/v1/my-bets/${ticketId}`);
                if (!ticketRes.ok) throw new Error(`Ticket #${ticketId} non trouvé`);
                const ticketPayload = await ticketRes.json();
                const originalTicket = ticketPayload?.data || ticketPayload;
                const originalBets = originalTicket?.bets || [];

                if (originalBets.length === 0) {
                    this.alertModal('Ce ticket ne contient pas de paris réutilisables.', 'error');
                    return;
                }

                // Récupérer le round actuel pour obtenir les participants
                const roundRes = await fetch('/api/v1/rounds/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get' })
                });
                if (!roundRes.ok) throw new Error('Impossible de récupérer le round actuel');
                const roundData = await roundRes.json();
                const currentRound = roundData?.data || {};

                // Ne pas rebet pendant une course en cours
                if (currentRound.isRaceRunning) {
                    this.alertModal('Impossible de rejouer ce ticket pendant que la course est en cours.', 'error');
                    return;
                }

                const participants = currentRound.participants || [];

                // Construire le formulaire HTML pour permettre à l'utilisateur d'ajuster les montants
                const formHtml = originalBets.map((b, idx) => {
                    // Use the original participant info (number, name, coeff) so rebet preserves the same participants and odds
                    const origPart = b.participant || { number: b.number };
                    const num = origPart.number ?? '';
                    const participantLabel = origPart.name ? `${origPart.name} (N°${num})` : `N°${num}`;
                    const coeffLabel = (typeof origPart.coeff !== 'undefined') ? ` — cote: x${Number(origPart.coeff).toFixed(2)}` : '';

                    // Valeur publique par défaut (si value est en système)
                    const defaultValue = (typeof window.Currency !== 'undefined' && typeof window.Currency.systemToPublic === 'function')
                        ? window.Currency.systemToPublic(b.value || 0)
                        : (b.value || 0);

                    // Show the original public value as a placeholder, but reinitialize the field (empty value)
                    const placeholderVal = (typeof defaultValue === 'object' && typeof defaultValue.toString === 'function') ? defaultValue.toString() : (Number(defaultValue || 0).toFixed((window.Currency && window.Currency.visibleDigits) || 2));
                    return `
                        <div class="mb-2">
                            <label style="display:block;font-weight:600;margin-bottom:4px;">Pari ${idx+1}: ${participantLabel}${coeffLabel}</label>
                            <input data-bet-index="${idx}" class="rebet-amount" type="number" step="0.01" min="0" value="" placeholder="${placeholderVal}" style="width:100%;padding:6px;border-radius:4px;border:1px solid #333;background:#0f1724;color:#fff;" />
                        </div>
                    `;
                }).join('');

                // Afficher le modal pour saisir les montants
                this.showModal({
                    title: `Rejouer le ticket #${ticketId}`,
                    message: `<div id="rebetForm">${formHtml}</div>`,
                    type: 'confirm',
                    confirmText: 'Valider & Imprimer',
                    cancelText: 'Annuler',
                    confirmColor: 'bg-green-600 hover:bg-green-700',
                    cancelColor: 'bg-slate-700 hover:bg-slate-600',
                    onConfirm: async () => {
                        try {
                            // Récupérer les montants saisis
                            const modalEl = document.getElementById('appModal');
                            const inputs = modalEl.querySelectorAll('.rebet-amount');
                            const newBets = [];
                            inputs.forEach((inp, i) => {
                                // Read user input; if empty, fall back to placeholder
                                let raw = inp.value;
                                if (!raw || raw === '') raw = inp.placeholder || '0';
                                const userVal = Number(raw || 0);

                                // Preserve the original participant object (number, name, coeff)
                                const origPart = originalBets[i].participant || { number: originalBets[i].number };
                                const participant = { number: origPart.number };
                                if (typeof origPart.coeff !== 'undefined') participant.coeff = origPart.coeff;
                                if (origPart.name) participant.name = origPart.name;

                                // Multiply user input by 10^2 (×100) to produce the system value (cents)
                                // Use Big if available for precise arithmetic
                                let systemValue = 0;
                                try {
                                    if (typeof window.Big !== 'undefined') {
                                        // scaled = round(userVal * 100)
                                        const scaled = new Big(userVal).times(100).round(0, 0);
                                        systemValue = (typeof scaled.toNumber === 'function') ? scaled.toNumber() : Number(scaled);
                                    } else {
                                        systemValue = Math.round(userVal * 100);
                                    }
                                } catch (err) {
                                    console.warn('Currency scaling failed, falling back to Math.round:', err);
                                    systemValue = Math.round(userVal * 100);
                                }

                                newBets.push({ participant, value: systemValue, prize: 0 });
                            });

                            if (newBets.length === 0) {
                                this.alertModal('Aucun pari valide fourni pour le rebet.', 'error');
                                return;
                            }

                            // Envoyer la requête de création de ticket
                            const addRes = await fetch('/api/v1/receipts/?action=add', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ bets: newBets })
                            });
                            const addData = await addRes.json().catch(() => null);
                            if (!addRes.ok) {
                                throw new Error(addData?.error || addData?.message || `HTTP ${addRes.status}`);
                            }

                            const newId = addData?.data?.id || addData?.id || null;
                            this.showToast(`✅ Ticket #${newId} créé avec succès (rebet de #${ticketId})`, 'success');

                            // Ouvrir l'impression du ticket (même logique que le reste)
                            if (newId) {
                                if (typeof window.printTicket === 'function') {
                                    window.printTicket(newId);
                                } else {
                                    // printTicket should always be present (printJS is guaranteed). If not, notify.
                                    this.alertModal('Erreur: printTicket non disponible pour imprimer le ticket.', 'error');
                                }
                            }

                            // Rafraîchir les listes
                            if (this.currentPage === 'dashboard' && typeof this.dashboardRefreshTickets === 'function') {
                                this.dashboardRefreshTickets();
                            }
                            if (this.currentPage === 'my-bets' && typeof this.myBetsFetchMyBets === 'function') {
                                this.myBetsFetchMyBets(1);
                            }

                        } catch (err) {
                            console.error('Erreur lors du rebet (modal confirm):', err);
                            this.alertModal(err.message || 'Erreur lors du rebet', 'error');
                        }
                    }
                });

            } catch (err) {
                console.error('Erreur rebetTicket:', err);
                this.alertModal(err.message || 'Erreur lors du rebet', 'error');
            }
        }

    logout() {
        this.confirmModal(
            'Êtes-vous sûr de vouloir vous déconnecter ?',
            () => {
                this.showToast('Déconnexion...');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 1000);
            }
        );
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
                    const totalDuration = data.timerTotalDuration || 180000;
                    if (this.dashboardDemarrerTimer) {
                        // Petit délai pour s'assurer que initDashboard est terminé
                        setTimeout(() => {
                            if (this.dashboardDemarrerTimer) {
                                this.dashboardDemarrerTimer(data.timerTimeLeft, totalDuration);
                            }
                        }, 100);
                    } else {
                        console.warn('⚠️ dashboardDemarrerTimer non disponible, initDashboard pas encore terminé');
                    }
                }
                // Synchroniser l'état de la course si elle est en cours
                // Note: betFrameOverlay est géré par main.js
                if (this.currentPage === 'dashboard' && data.isRaceRunning && data.raceStartTime) {
                    // Arrêter le timer pendant la course
                    if (this.dashboardArreterTimer) {
                        this.dashboardArreterTimer();
                    }
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
                // Réinitialiser l'état de la course
                this.isRaceRunning = false;
                const newRoundId = data.roundId || data.game?.id || data.currentRound?.id;
                // Note: betFrameOverlay est caché par main.js quand nouveau round différent
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
                        // Petit délai pour s'assurer que initDashboard est terminé
                        setTimeout(() => {
                            if (this.dashboardDemarrerTimer) {
                                this.dashboardDemarrerTimer(data.timer.timeLeft, data.timer.totalDuration || 180000);
                            }
                        }, 100);
                    } else {
                        console.warn('⚠️ dashboardDemarrerTimer non disponible, initDashboard pas encore terminé');
                    }
                } else if (this.currentPage === 'dashboard' && data.nextRoundStartTime) {
                    // Calculer le temps restant depuis nextRoundStartTime
                    const timeLeft = Math.max(0, data.nextRoundStartTime - Date.now());
                    if (timeLeft > 0 && this.dashboardDemarrerTimer) {
                        const totalDuration = data.timer?.totalDuration || 180000;
                        // Petit délai pour s'assurer que initDashboard est terminé
                        setTimeout(() => {
                            if (this.dashboardDemarrerTimer) {
                                this.dashboardDemarrerTimer(timeLeft, totalDuration);
                            }
                        }, 100);
                    } else if (timeLeft > 0) {
                        console.warn('⚠️ dashboardDemarrerTimer non disponible, initDashboard pas encore terminé');
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
                // Mettre à jour l'état de la course
                this.isRaceRunning = true;
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
                // Rafraîchir les tickets pour masquer les boutons d'annulation
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets();
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1);
                }
                // Note: betFrameOverlay est géré par main.js
                // Notification
                this.showToast(`🏁 Course démarrée - Round #${data.roundId || 'N/A'}`, 'info');
                break;

            case 'race_end':
                console.log('🏆 Course terminée - Round:', data.roundId, 'Gagnant:', data.winner);
                // Note: betFrameOverlay reste visible jusqu'à new_round (géré par main.js)
                // Réinitialiser l'état de la course
                this.isRaceRunning = false;
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

    // Note: showRaceOverlay et hideRaceOverlay supprimées
    // betFrameOverlay est maintenant géré uniquement par main.js

    init() {
        this.setupEventListeners();
        this.loadPage('dashboard');

        // Exposer les helpers globaux pour qu'ils soient disponibles quel que soit la page
        window.rebetTicket = (id) => this.rebetTicket(id);
        window.cancelTicket = (id) => this.cancelTicket(id);
        // Impression centralisée via printJS (printJS est garanti)
        window.printTicket = async (id) => {
            try {
                const res = await fetch(`/api/v1/receipts/?action=print&id=${id}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const html = await res.text();
                // printJS doit être présent sur la page
                if (typeof printJS !== 'function') {
                    throw new Error('printJS non trouvé sur la page');
                }
                printJS({ printable: html, type: 'raw-html' });
            } catch (err) {
                console.error('Erreur printTicket:', err);
                this.showToast(err.message || 'Erreur impression', 'error');
            }
        };

        // Initialiser WebSocket
        this.connectWebSocket();
    }
}

// Initialiser l'application quand le DOM est chargé
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});