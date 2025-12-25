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
        this.bettingLocked = false; // État de verrouillage des paris (quelques secondes avant le lancement)
        this.timerTimeLeft = 0; // Temps restant avant le lancement (en ms)
        this.bettingLockDurationMs = 5000; // Délai de sécurité : 5 secondes avant le lancement
        this.debugWs = false; // ✅ Perf: éviter de spammer la console à chaque message WS
        this.currentRoundId = null; // ✅ CORRECTION: Round ID actuel (pour affichage dashboard)

        // ✅ Overlay bet_frame + auto-finish (anciennement dans main.js)
        this.betFrameState = {
            currentRoundId: null,
            countdownInterval: null,
            countdownStart: 0,
            countdownDuration: 0,
            finishInFlight: false
        };
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
            console.debug(`Chargement de la page: ${this.pages[pageId]}`);

            const response = await fetch(this.pages[pageId]);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();

            document.getElementById('page-container').innerHTML = html;
            document.getElementById('pageTitle').textContent = this.getPageTitle(pageId);

            this.currentPage = pageId;
            this.updateActiveNavLink(pageId);

            // ✅ OPTIMISATION: la page est injectée via innerHTML.
            // Les <script> du HTML injecté ne sont pas exécutés, donc pas besoin d'attendre 50ms.
            // Un frame suffit pour laisser le DOM se peindre.
            await new Promise(resolve => requestAnimationFrame(resolve));

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
                // ✅ CORRECTION: Réinitialiser le cache lors de la navigation vers dashboard
                if (this.dashboardRefreshTickets) {
                    // Forcer le rafraîchissement si la fonction existe déjà
                    setTimeout(() => {
                        if (this.dashboardRefreshTickets) {
                            this.dashboardRefreshTickets(true);
                        }
                    }, 100);
                }
                this.initDashboard();
                break;
            case 'course-chevaux':
                this.initCourseChevaux();
                break;
            case 'my-bets':
                // ✅ CORRECTION: Forcer le rafraîchissement lors de la navigation vers my-bets
                // Si myBetsFetchMyBets existe déjà, forcer le rafraîchissement
                if (this.myBetsFetchMyBets) {
                    setTimeout(() => {
                        if (this.myBetsFetchMyBets) {
                            this.myBetsFetchMyBets(1);
                        }
                    }, 100);
                }
                this.initMyBets();
                break;
            case 'betting':
                this.initBetting();
                break;
            case 'account':
                this.initAccount();
                break;
        }
    }

    initDashboard() {
        console.debug('Initialisation de la page Dashboard');

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
        this.timerTotalDelayMs = 60000; // 2 minutes par défaut
        this.timerTargetEndTime = 0; // Timestamp exact de la fin du compte à rebours
        this.timerCountdownInterval = null; // ID de l'intervalle pour la mise à jour de la barre

        // Helper function
        const el = (id) => document.getElementById(id);
        
        // ✅ Overlay bet_frame (iframe) - géré ici (plus de main.js)
        this.initBetFrameOverlay();

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
           Fonction pour formater un ticket depuis les données WebSocket
        ------------------------- */
        const formatTicketForTable = (t) => {
            const roundId = t.roundId || t.round_id || '-';
            const createdTime = t.date || t.created_time || t.created_at || Date.now();
            
            // Calculer totalAmount depuis les bets si non fourni
            let totalAmount = t.totalAmount || t.total_amount || 0;
            if (!totalAmount && Array.isArray(t.bets)) {
                // Convertir de système à publique si nécessaire
                totalAmount = t.bets.reduce((sum, b) => {
                    const valueSystem = Number(b.value || 0);
                    // Si Currency est disponible, utiliser systemToPublic, sinon diviser par 100
                    if (typeof Currency !== 'undefined' && typeof Currency.systemToPublic === 'function') {
                        const valuePublic = Currency.systemToPublic(valueSystem);
                        return sum + (typeof valuePublic === 'object' && valuePublic.toNumber ? valuePublic.toNumber() : Number(valuePublic));
                    }
                    return sum + (valueSystem / 100);
                }, 0);
            }
            
            const total = totalAmount.toFixed(2);
            const isMultibet = Array.isArray(t.bets) && t.bets.length > 1;
            // For single bets, show the participant coeff; for multibets, show a compact label
            const coeffLabel = isMultibet ? `Multibet (${t.bets.length})` : (t.bets && t.bets[0] && t.bets[0].participant ? `x${Number(t.bets[0].participant.coeff).toFixed(2)}` : (t.avgCoeff ? `x${Number(t.avgCoeff).toFixed(2)}` : '-'));
            const hasPrize = t.prize && t.prize > 0;
            // Permettre l'annulation tant que le statut est "pending" ET que les paris ne sont pas verrouillés
            const canCancel = t.status === 'pending' && !this.bettingLocked && !this.isRaceRunning;
            
            return {
                roundId,
                createdTime,
                total,
                isMultibet,
                coeffLabel,
                hasPrize,
                canCancel,
                id: t.id || t.receiptId || t.receipt_id,
                status: t.status || 'pending',
                prize: t.prize || 0,
                paidAt: t.paidAt || t.paid_at || null
            };
        };

        /* -------------------------
           Fonction pour créer une ligne de ticket dans le tableau
        ------------------------- */
        const createTicketRow = (ticketData) => {
            const t = formatTicketForTable(ticketData);
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-700/50';
            tr.setAttribute('data-receipt-id', t.id);
            tr.innerHTML = `
                <td class="p-2 text-sm font-medium">#${t.id || '—'}</td>
                <td class="p-2 text-slate-400 text-xs">${new Date(t.createdTime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td class="p-2 text-sm text-slate-300">#${t.roundId}</td>
                <td class="p-2 text-sm font-semibold text-green-300">${t.total} HTG</td>
                <td class="p-2 text-sm text-slate-300">${t.coeffLabel}</td>
                <td class="p-2">${this.formatStatus(t.status)}</td>
                <td class="p-2">
                    <div class="flex gap-1 flex-wrap">
                        <button data-action="print" data-id="${t.id || ''}" 
                            class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded text-white" 
                            title="Imprimer">🖨️</button>
                        ${t.canCancel
                            ? `<button data-action="void" data-id="${t.id || ''}" 
                                class="px-2 py-1 bg-red-600 hover:bg-red-700 text-xs rounded text-white" 
                                title="Annuler">❌</button>`
                            : ''}
                        ${t.status === 'won'
                            ? `<button data-action="pay" data-id="${t.id || ''}" 
                                class="px-2 py-1 bg-green-600 hover:bg-green-700 text-xs rounded text-white" 
                                title="Payer le ticket">💵</button>`
                            : ''}
                        ${t.status === 'paid'
                            ? `<span class="px-2 py-1 bg-blue-500/30 text-blue-300 text-xs rounded" 
                                title="Payé le ${t.paidAt ? new Date(t.paidAt).toLocaleString('fr-FR') : 'N/A'}">✓ Payé</span>`
                            : ''}
                        <button data-action="rebet" data-id="${t.id || ''}" 
                            class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-xs rounded text-white" 
                            title="Rejouer ce ticket">🔄</button>
                    </div>
                </td>
            `;
            return tr;
        };

        /* -------------------------
           Fonction pour ajouter un ticket directement au tableau (WebSocket)
        ------------------------- */
        const addTicketToTable = (ticketData) => {
            const table = el('ticketsTable');
            if (!table) {
                console.warn('⚠️ #ticketsTable introuvable, refresh complet nécessaire');
                refreshTickets();
                return;
            }

            // Vérifier si le ticket existe déjà
            const existingRow = table.querySelector(`tr[data-receipt-id="${ticketData.id || ticketData.receiptId}"]`);
            if (existingRow) {
                console.log(`⚠️ Ticket #${ticketData.id || ticketData.receiptId} déjà présent, mise à jour...`);
                // Mettre à jour la ligne existante
                const newRow = createTicketRow(ticketData);
                existingRow.replaceWith(newRow);
                return;
            }

            // Si le tableau est vide ou contient "Aucun ticket", le vider d'abord
            if (table.innerHTML.includes('Aucun ticket')) {
                table.innerHTML = '';
            }

            // Ajouter le nouveau ticket en haut du tableau (le plus récent en premier)
            const newRow = createTicketRow(ticketData);
            table.insertBefore(newRow, table.firstChild);

            // Limiter à 50 tickets affichés (garder les plus récents)
            const rows = table.querySelectorAll('tr[data-receipt-id]');
            if (rows.length > 50) {
                rows[rows.length - 1].remove();
            }

            // ✅ Mettre à jour les stats immédiatement
            updateStatsFromTicket(ticketData);
        };

        /* -------------------------
           Fonction pour supprimer un ticket directement du tableau (WebSocket)
        ------------------------- */
        const removeTicketFromTable = (ticketId) => {
            const table = el('ticketsTable');
            if (!table) return;

            const row = table.querySelector(`tr[data-receipt-id="${ticketId}"]`);
            if (row) {
                row.remove();
                
                // Si le tableau est vide, afficher "Aucun ticket"
                if (table.querySelectorAll('tr[data-receipt-id]').length === 0) {
                    table.innerHTML = `<tr><td colspan="7" class="p-4 text-slate-400">Aucun ticket</td></tr>`;
                }
                
                // ✅ Mettre à jour les stats
                refreshTickets(); // Refresh pour recalculer les stats correctement
            }
        };

        /* -------------------------
           Fonction pour mettre à jour les stats depuis un ticket ajouté
        ------------------------- */
        const updateStatsFromTicket = (ticketData) => {
            // Calculer le totalAmount depuis les bets
            let ticketTotal = ticketData.totalAmount || ticketData.total_amount || 0;
            if (!ticketTotal && Array.isArray(ticketData.bets)) {
                ticketTotal = ticketData.bets.reduce((sum, b) => {
                    const valueSystem = Number(b.value || 0);
                    if (typeof Currency !== 'undefined' && typeof Currency.systemToPublic === 'function') {
                        const valuePublic = Currency.systemToPublic(valueSystem);
                        return sum + (typeof valuePublic === 'object' && valuePublic.toNumber ? valuePublic.toNumber() : Number(valuePublic));
                    }
                    return sum + (valueSystem / 100);
                }, 0);
            }

            // Mettre à jour le total des mises
            const totalBetsAmountEl = el('totalBetsAmount');
            if (totalBetsAmountEl) {
                const currentTotal = parseFloat(totalBetsAmountEl.textContent.replace(' HTG', '').replace(/\s/g, '')) || 0;
                const newTotal = (currentTotal + ticketTotal).toFixed(2);
                totalBetsAmountEl.textContent = `${newTotal} HTG`;
            }

            // Mettre à jour le nombre de tickets actifs
            const activeTicketsCountEl = el('activeTicketsCount');
            if (activeTicketsCountEl) {
                const table = el('ticketsTable');
                if (table) {
                    const activeCount = table.querySelectorAll('tr[data-receipt-id]').length;
                    activeTicketsCountEl.textContent = activeCount;
                }
            }
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
                const tr = createTicketRow(t);
                table.appendChild(tr);
            });
        }

        /* -------------------------
           Fonction rebet
        ------------------------- */
        const rebetTicket = async (ticketId) => {
            // ✅ SÉCURITÉ: Vérifier si le placement de paris est autorisé
            const bettingCheck = isBettingAllowed();
            if (!bettingCheck.allowed) {
                this.alertModal(`❌ ${bettingCheck.reason}. Le placement de paris n'est pas autorisé.`, 'error');
                return;
            }
            
            try {
                // Récupérer le ticket original avec ses bets
                const ticketRes = await fetch(`/api/v1/my-bets/${ticketId}`, { credentials: 'include' });
                if (!ticketRes.ok) throw new Error('Ticket non trouvé');
                const ticketData = await ticketRes.json();
                const originalTicket = ticketData?.data;
                if (!originalTicket || !originalTicket.bets || originalTicket.bets.length === 0) {
                    throw new Error('Ticket invalide ou sans paris');
                }
                
                // Récupérer le round actuel pour obtenir les participants
                const roundRes = await fetch('/api/v1/rounds/', {
                    method: 'POST',
                    credentials: 'include',
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
                
                // ✅ SÉCURITÉ: Vérifier si le placement de paris est autorisé
                const bettingCheck = isBettingAllowed();
                if (!bettingCheck.allowed) {
                    throw new Error(bettingCheck.reason);
                }
                
                const addRes = await fetch('/api/v1/receipts/?action=add', {
                    method: 'POST',
                    credentials: 'include',
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
        const payTicket = async (ticketId, buttonElement = null) => {
            this.confirmModal(
                `Confirmer le paiement du ticket #${ticketId} ?<br><br>Le ticket sera marqué comme payé, puis le décaissement sera imprimé.`,
                async () => {
                    try {
                        // Get button element if not provided
                        if (!buttonElement && event && event.target) {
                            buttonElement = event.target;
                        }
                        
                        // Show loading state on button
                        if (buttonElement && window.buttonLoader) {
                            window.buttonLoader.start(buttonElement, 'Traitement du paiement...');
                        }
                        
                        // Attendre un court délai pour que la fenêtre se charge
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // 1️⃣ Effectuer le paiement avec enhanced fetch client ou fallback
                        let data;
                        if (window.enhancedFetch && typeof window.enhancedFetch.post === 'function') {
                            data = await window.enhancedFetch.post(
                                `/api/v1/my-bets/pay/${ticketId}`,
                                {},
                                buttonElement
                            );
                        } else {
                            // Fallback si les modules n'ont pas chargé
                            const res = await fetch(`/api/v1/my-bets/pay/${ticketId}`, {
                                method: 'POST',
                                credentials: 'include'
                            });
                            data = await res.json();
                            if (!res.ok) throw new Error(data.error || data.message || 'Erreur lors du paiement');
                        }
                        
                        // 2️⃣ ✅ IMPRESSION DU DÉCAISSEMENT APRÈS LE PAIEMENT
                        try {
                            const payoutRes = await fetch(`/api/v1/receipts/?action=payout&id=${ticketId}`);
                            if (payoutRes.ok) {
                                const payoutHtml = await payoutRes.text();
                                console.log(`✅ [PAY] HTML du décaissement reçu pour le ticket #${ticketId}`);
                                
                                // Essayer printJS d'abord
                                if (typeof window.printJS === 'function') {
                                    console.log(`✅ [PAY] printJS disponible, déclenchement de l'impression`);
                                    window.printJS({ printable: payoutHtml, type: 'raw-html' });
                                } else {
                                    // Fallback: créer une iframe et imprimer
                                    console.log(`⚠️ [PAY] printJS non disponible, utilisation fallback iframe`);
                                    const printWindow = window.open('', '', 'height=600,width=800');
                                    if (printWindow) {
                                        printWindow.document.write(payoutHtml);
                                        printWindow.document.close();
                                        // Attendre le chargement du contenu
                                        setTimeout(() => {
                                            printWindow.print();
                                            // Ne pas fermer la fenêtre immédiatement pour laisser le temps d'imprimer
                                            setTimeout(() => printWindow.close(), 500);
                                        }, 250);
                                    } else {
                                        console.warn('⚠️ [PAY] Impossible d\'ouvrir la fenêtre d\'impression');
                                    }
                                }
                            } else {
                                console.warn(`⚠️ [PAY] Impossible de récupérer le décaissement (HTTP ${payoutRes.status})`);
                            }
                        } catch (printErr) {
                            console.error('❌ [PAY] Erreur lors de l\'impression du décaissement:', printErr);
                            // Ne pas bloquer le processus si l'impression échoue
                        }
                        
                        // ✅ OPTIMISATION: Refresh via WebSocket (receipt_paid event) - pas besoin de setTimeout
                        // refreshTickets() sera appelé automatiquement par handleWebSocketMessage('receipt_paid')
                        
                        // 4️⃣ Message de confirmation
                        const prizeAmount = data.data?.prize ? Number(data.data.prize).toFixed(2) : 'N/A';
                        this.alertModal(
                            `✅ Ticket #${ticketId} payé avec succès (${prizeAmount} HTG)<br><br>Le décaissement a été envoyé à l'imprimante.`,
                            'success'
                        );
                        
                    } catch (err) {
                        console.error('Erreur payTicket:', err);
                        this.alertModal(err.message || 'Erreur lors du paiement', 'error');
                    } finally {
                        // Stop loading state on button
                        if (buttonElement && window.buttonLoader) {
                            window.buttonLoader.stop(buttonElement);
                        }
                    }
                } // end confirmModal callback
            ); // end confirmModal
        }; // end payTicket

        /* -------------------------
           Vérification de sécurité : Les paris sont-ils autorisés ?
        ------------------------- */
        const isBettingAllowed = () => {
            // Vérifier si une course est en cours
            if (this.isRaceRunning) {
                return { allowed: false, reason: 'Une course est en cours' };
            }
            
            // Vérifier si le timer est proche de 0 (délai de sécurité)
            if (this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs) {
                const secondsLeft = Math.ceil(this.timerTimeLeft / 1000);
                return { 
                    allowed: false, 
                    reason: `Les paris sont fermés. Démarrage dans ${secondsLeft} seconde${secondsLeft > 1 ? 's' : ''}` 
                };
            }
            
            return { allowed: true };
        };

        /* -------------------------
           Fonction cancelTicket pour le dashboard
        ------------------------- */
        const cancelTicket = async (ticketId, buttonElement = null) => {
            // ✅ SÉCURITÉ: Vérifier si l'annulation est autorisée
            const bettingCheck = isBettingAllowed();
            if (!bettingCheck.allowed) {
                this.alertModal(`❌ ${bettingCheck.reason}. L'annulation n'est pas autorisée.`, 'error');
                return;
            }
            
            this.confirmModal(
                `Confirmer l'annulation du ticket #${ticketId} ?`,
                async () => {
                    try {
                        // Get button element if not provided
                        if (!buttonElement && event && event.target) {
                            buttonElement = event.target;
                        }
                        
                        // Show loading state on button
                        if (buttonElement && window.buttonLoader) {
                            window.buttonLoader.start(buttonElement, 'Annulation en cours...');
                        }
                        
                        console.log(`[CLIENT] Deleting receipt id=${ticketId} -> /api/v1/receipts/?action=delete&id=${ticketId}`);
                        
                        // Call API with enhanced fetch client ou fallback
                        let data;
                        if (window.enhancedFetch && typeof window.enhancedFetch.post === 'function') {
                            data = await window.enhancedFetch.post(
                                `/api/v1/receipts/?action=delete&id=${ticketId}`,
                                {},
                                buttonElement
                            );
                        } else {
                            // Fallback si les modules n'ont pas chargé
                            const res = await fetch(`/api/v1/receipts/?action=delete&id=${ticketId}`, {
                                method: 'POST',
                                credentials: 'include'
                            });
                            data = await res.json();
                            if (!res.ok) throw new Error(data.error || data.message || 'Erreur lors de l\'annulation');
                        }
                        
                        // Rafraîchir immédiatement la liste des tickets pour synchroniser l'UI
                        try { refreshTickets(); } catch (e) { console.warn('refreshTickets failed after delete:', e); }
                        this.alertModal(`✅ Ticket #${ticketId} annulé avec succès`, 'success');
                        
                    } catch (err) {
                        console.error('Erreur cancelTicket:', err);
                        this.alertModal(
                            err.message || 'Impossible d\'annuler ce ticket. La course est peut-être déjà terminée avec résultats.',
                            'error'
                        );
                    } finally {
                        // Stop loading state on button
                        if (buttonElement && window.buttonLoader) {
                            window.buttonLoader.stop(buttonElement);
                        }
                    }
                }
            );
        };

    // Rendre les fonctions accessibles globalement
    window.payTicket = payTicket;
    // Exposer cancelTicket correctement (appelera la fonction locale si présente,
    // sinon délèguera à window.app.cancelTicket si l'application est initialisée)
    window.cancelTicket = (id) => {
        if (typeof cancelTicket === 'function') return cancelTicket(id);
        if (window.app && typeof window.app.cancelTicket === 'function') return window.app.cancelTicket(id);
        console.error('cancelTicket function not available');
    };

        /* -------------------------
           Rafraîchissement
        ------------------------- */
        // ✅ OPTIMISATION: Cache pour éviter les requêtes répétées
        let ticketsCache = { data: null, timestamp: 0, ttl: 2000 }; // Cache 2s
        
        const refreshTickets = async (force = false) => {
            try {
                // ✅ CORRECTION: Toujours rafraîchir lors du chargement initial de la page (force = true)
                // Le cache ne doit pas empêcher l'affichage des tickets lors de la navigation
                const now = Date.now();
                const isInitialLoad = !ticketsCache.data || (now - ticketsCache.timestamp) > 5000; // Cache expiré après 5s
                
                if (!force && !isInitialLoad && ticketsCache.data && (now - ticketsCache.timestamp) < ticketsCache.ttl) {
                    const { tickets, stats, round } = ticketsCache.data;
                    updateTicketsTable(tickets);
                    if (round) updateStats(round, stats);
                    if (this.updateBettingButtonsState) this.updateBettingButtonsState();
                    return;
                }
                
                // ✅ CORRECTION: Le dashboard doit afficher TOUS les tickets du round actuel
                // Utiliser /api/v1/init/dashboard pour récupérer tous les tickets (pas de filtre user_id)
                
                let tickets = [];
                let roundId = this.currentRoundId;
                let round = null;
                let stats = {};
                
                // ✅ Source: Récupérer TOUS les tickets du round actuel depuis /api/v1/init/dashboard
                try {
                    const res = await fetch('/api/v1/init/dashboard', { 
                        credentials: 'include',
                        cache: force ? 'no-cache' : 'default'
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    const dashboardData = data?.data || {};
                    
                    // Récupérer les tickets bruts depuis gameState.currentRound.receipts
                    const rawTickets = dashboardData.tickets || [];
                    const roundData = dashboardData.round || {};
                    
                    // Formater les tickets pour correspondre au format attendu
                    tickets = rawTickets.map(t => {
                        // Convertir les valeurs système (×100) en valeurs publiques
                        const totalAmount = typeof t.total_amount === 'number' ? t.total_amount / 100 : 
                                          (typeof t.total_amount === 'string' ? parseFloat(t.total_amount) / 100 : 0);
                        
                        return {
                            id: t.id || t.receipt_id,
                            receiptId: t.id || t.receipt_id,
                            roundId: t.round_id || t.roundId || roundData.id,
                            status: t.status || 'pending',
                            prize: typeof t.prize === 'number' ? t.prize / 100 : 
                                  (typeof t.prize === 'string' ? parseFloat(t.prize) / 100 : 0),
                            bets: t.bets || [],
                            totalAmount: totalAmount,
                            created_time: t.created_time || t.created_at || t.date,
                            date: t.created_time || t.created_at || t.date,
                            user_id: t.user_id || null
                        };
                    });
                    
                    roundId = roundData.id || (tickets.length > 0 ? tickets[0]?.roundId : null);
                    if (roundId) {
                        this.currentRoundId = roundId;
                    }
                    
                    // Créer l'objet round avec tous les tickets
                    round = {
                        id: roundId,
                        participants: roundData.participants || [],
                        receipts: tickets,
                        totalPrize: dashboardData.totalPrize || 0
                    };
                    
                    // Calculer les stats basiques
                    stats = {
                        totalReceipts: tickets.length,
                        totalMise: tickets.reduce((sum, t) => sum + (t.totalAmount || 0), 0),
                        totalPrize: round.totalPrize || 0
                    };
                    
                    console.debug(`✅ [DASHBOARD] ${tickets.length} ticket(s) du round actuel récupéré(s)`);
                } catch (err) {
                    console.error('❌ [DASHBOARD] Erreur récupération tickets:', err);
                    throw err;
                }
                
                // ✅ CORRECTION: Mettre à jour le cache avec les données complètes
                ticketsCache = { data: { tickets, stats, round }, timestamp: now, ttl: 2000 };
                
                // ✅ CORRECTION: Toujours mettre à jour le tableau, même si tickets est vide
                // Cela garantit que les tickets sont toujours affichés correctement
                updateTicketsTable(tickets);
                if (round) updateStats(round, stats);
                if (this.updateBettingButtonsState) this.updateBettingButtonsState();
                
                console.debug(`✅ [DASHBOARD] Tickets mis à jour: ${tickets.length} ticket(s) affiché(s)`);
            } catch (err) {
                console.error('Erreur refreshTickets:', err);
                this.showToast('Erreur de connexion à l\'API.', 'error');
            }
        };

        // ✅ OPTIMISATION: Timer synchronisé via WebSocket (timer_update event) - plus besoin de fetch
        const synchroniserTimer = () => {
            // Le timer est maintenant synchronisé via WebSocket events (timer_update)
            // Cette fonction est gardée pour compatibilité mais ne fait plus de fetch
            if (!this.dashboardDemarrerTimer) {
                requestAnimationFrame(() => {
                    if (this.dashboardDemarrerTimer && this.timerTimeLeft > 0) {
                        this.dashboardDemarrerTimer(this.timerTimeLeft, 60000);
                    }
                });
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
            const currentRoundTimerEl = document.getElementById('currentRoundTimer');

            if (totalBetsAmountEl) totalBetsAmountEl.textContent = `${total.toFixed(2)} HTG`;
            if (activeTicketsCountEl) activeTicketsCountEl.textContent = activeCount;
            
            // ✅ CORRECTION: Mettre à jour le round ID dans le header ET dans currentRoundId
            const roundId = round?.id || this.currentRoundId;
            if (roundId) {
                this.currentRoundId = roundId;
                if (currentRoundEl) currentRoundEl.textContent = roundId;
                if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${roundId}`;
            }
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

            // ✅ SÉCURITÉ: Mettre à jour le temps restant pour la vérification
            this.timerTimeLeft = timeLeft;
            this.bettingLocked = timeLeft > 0 && timeLeft <= this.bettingLockDurationMs;
            
            // ✅ SÉCURITÉ: Mettre à jour l'état des boutons
            this.updateBettingButtonsState();

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
                this.bettingLocked = false; // Les paris sont fermés après le lancement
                this.updateBettingButtonsState();
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
            this.timerTotalDelayMs = totalDuration || 60000;
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

        /* -------------------------
           Mise à jour de l'état des boutons selon le verrouillage
        ------------------------- */
        const updateBettingButtonsState = () => {
            const isLocked = this.bettingLocked || this.isRaceRunning;
            const secondsLeft = Math.ceil(this.timerTimeLeft / 1000);
            
            // Désactiver/activer les boutons d'annulation
            document.querySelectorAll('[data-action="void"]').forEach(btn => {
                if (isLocked) {
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    btn.title = `Annulation désactivée${this.bettingLocked ? ` (démarrage dans ${secondsLeft}s)` : ' (course en cours)'}`;
                } else {
                    btn.disabled = false;
                    btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    btn.title = 'Annuler le ticket';
                }
            });
            
            // Désactiver/activer les boutons de rebet
            document.querySelectorAll('[data-action="rebet"]').forEach(btn => {
                if (isLocked) {
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    btn.title = `Rejouer désactivé${this.bettingLocked ? ` (démarrage dans ${secondsLeft}s)` : ' (course en cours)'}`;
                } else {
                    btn.disabled = false;
                    btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    btn.title = 'Rejouer ce ticket';
                }
            });
            
            // Afficher un message d'avertissement si les paris sont verrouillés
            let warningEl = document.getElementById('bettingLockWarning');
            if (isLocked && this.bettingLocked) {
                if (!warningEl) {
                    warningEl = document.createElement('div');
                    warningEl.id = 'bettingLockWarning';
                    warningEl.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-semibold';
                    document.body.appendChild(warningEl);
                }
                warningEl.textContent = `⚠️ Les paris sont fermés. Démarrage dans ${secondsLeft} seconde${secondsLeft > 1 ? 's' : ''}`;
                warningEl.style.display = 'block';
            } else if (warningEl) {
                warningEl.style.display = 'none';
            }
        };

        // Stocker les fonctions pour utilisation par WebSocket
        this.dashboardRefreshTickets = refreshTickets;
        this.dashboardUpdateStats = updateStats;
        this.dashboardAddTicketToTable = addTicketToTable; // ✅ NOUVEAU: Ajouter directement un ticket
        this.dashboardRemoveTicketFromTable = removeTicketFromTable; // ✅ NOUVEAU: Supprimer directement un ticket
        this.dashboardDemarrerTimer = demarrerTimer;
        this.dashboardArreterTimer = arreterTimer;
        this.dashboardMettreAJourProgressBar = mettreAJourProgressBar;
        this.dashboardSynchroniserTimer = synchroniserTimer;
        this.isBettingAllowed = isBettingAllowed; // Exposer la fonction de vérification
        this.updateBettingButtonsState = updateBettingButtonsState; // Exposer la fonction de mise à jour des boutons

        // ✅ CORRECTION: Initialiser le round ID au chargement
        const initRoundId = async () => {
            try {
                const res = await fetch('/api/v1/rounds/', { 
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get' })
                });
                if (res.ok) {
                    const data = await res.json();
                    const roundId = data?.data?.id || null;
                    if (roundId) {
                        this.currentRoundId = roundId;
                        const currentRoundEl = document.getElementById('currentRound');
                        const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                        if (currentRoundEl) currentRoundEl.textContent = roundId;
                        if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${roundId}`;
                    }
                }
            } catch (err) {
                console.debug('Erreur init round ID:', err);
            }
        };
        
        // ✅ CORRECTION: Rafraîchir immédiatement avec force=true pour éviter le cache lors de la navigation
        refreshTickets(true);
        
        // Initialiser le round ID
        initRoundId();

        // ✅ OPTIMISATION: Synchronisation via requestAnimationFrame (plus rapide)
        requestAnimationFrame(() => synchroniserTimer());

        // Configurer le bouton de rafraîchissement
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshTickets();
                synchroniserTimer();
            });
        }

        // Le WebSocket mettra à jour automatiquement via handleWebSocketMessage
        console.debug('✅ Dashboard initialisé avec WebSocket en temps réel');
    }

    initCourseChevaux() {
        // Initialiser la page Course Chevaux
        console.debug('Initialisation de la page Course Chevaux');
        // Le jeu devrait s'initialiser automatiquement via les scripts existants
    }

    initMyBets() {
        console.debug("%c[INIT] Chargement de la page Mes Paris...", "color: #3b82f6");

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
        
        /* -------------------------
           Fonction pour créer une ligne de ticket pour my-bets
        ------------------------- */
        const createMyBetsTicketRow = (ticket) => {
            const isMultibet = Array.isArray(ticket.bets) && ticket.bets.length > 1;
            const canCancel = ticket.status === 'pending' && !this.bettingLocked && !this.isRaceRunning;
            const isInCurrentRound = ticket.roundId === this.currentRoundId;
            
            return `
                <tr class="hover:bg-slate-700/50" data-receipt-id="${ticket.id}">
                    <td class="p-2">${ticket.id}</td>
                    <td class="p-2">${new Date(ticket.date).toLocaleString('fr-FR')}</td>
                    <td class="p-2">${ticket.roundId}</td>
                    <td class="p-2">
                        ${isMultibet ? `
                            <div class="text-sm font-medium">Multibet (${ticket.bets.length} paris)</div>
                            <div class="text-xs text-slate-400 mt-1">Total: ${ticket.totalAmount.toFixed(2)} HTG</div>
                        ` : ticket.bets.map(bet => `
                            <div class="text-sm mb-1">
                                <span title="Participant">#${bet.participant?.number || bet.number} ${bet.participant?.name || ''}</span>
                                <span class="text-slate-400"> - </span>
                                <span title="Mise">${(parseFloat(bet.value) || 0).toFixed(2)} HTG</span>
                                <span class="text-slate-400">×</span>
                                <span title="Cote">${bet.participant?.coeff || 0}x</span>
                                <span class="text-slate-400">=</span>
                                <span title="Gain potentiel">${((parseFloat(bet.value) || 0) * (bet.participant?.coeff || 0)).toFixed(2)} HTG</span>
                            </div>
                        `).join('')}
                    </td>
                    <td class="p-2">${isMultibet ? `Multibet (${ticket.bets.length})` : `${(ticket.avgCoeff || 0).toFixed(2)}x`}</td>
                    <td class="p-2">${isMultibet ? '-' : `${(ticket.potentialWinnings || 0).toFixed(2)} HTG`}</td>
                    <td class="p-2">${this.formatStatus(ticket.status)}</td>
                    <td class="p-2">
                        <div class="flex items-center gap-2">
                            <button onclick="window.printTicket && window.printTicket(${ticket.id})" 
                                class="p-1 hover:bg-slate-600 rounded" title="Imprimer">🖨️</button>
                            ${ticket.status === 'won' ? 
                                `<button onclick="payTicket(${ticket.id}, this)" 
                                         class="p-1 hover:bg-slate-600 rounded" title="Payer">💰</button>` : ''}
                            ${canCancel && isInCurrentRound ? 
                                `<button onclick="cancelTicket(${ticket.id}, this)" 
                                         class="p-1 hover:bg-slate-600 rounded" title="Annuler">❌</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        };

        /* -------------------------
           Fonction pour ajouter un ticket directement au tableau my-bets (WebSocket)
        ------------------------- */
        const addTicketToMyBetsTable = (ticketData) => {
            if (!ticketsTableBody) {
                console.warn('⚠️ ticketsTableBody introuvable, refresh complet nécessaire');
                fetchMyBets(currentPage);
                return;
            }

            // Vérifier si le ticket appartient à l'utilisateur connecté
            // Note: On suppose que le serveur filtre déjà par user_id dans le broadcast
            // Mais on peut aussi vérifier ici si nécessaire

            // Vérifier si le ticket existe déjà
            const existingRow = ticketsTableBody.querySelector(`tr[data-receipt-id="${ticketData.id || ticketData.receiptId}"]`);
            if (existingRow) {
                console.log(`⚠️ Ticket #${ticketData.id || ticketData.receiptId} déjà présent dans my-bets, mise à jour...`);
                // Mettre à jour la ligne existante
                const newRowHtml = createMyBetsTicketRow(ticketData);
                existingRow.outerHTML = newRowHtml;
                return;
            }

            // Si le tableau est vide ou contient "Aucun ticket", le vider d'abord
            if (ticketsTableBody.innerHTML.includes('Aucun ticket') || ticketsTableBody.innerHTML.includes('Chargement')) {
                ticketsTableBody.innerHTML = '';
            }

            // Formater le ticket pour my-bets
            const formattedTicket = {
                id: ticketData.id || ticketData.receiptId,
                date: ticketData.date || ticketData.created_time || new Date().toISOString(),
                roundId: ticketData.roundId,
                bets: ticketData.bets || [],
                totalAmount: ticketData.totalAmount || 0,
                status: ticketData.status || 'pending',
                prize: ticketData.prize || 0,
                isMultibet: Array.isArray(ticketData.bets) && ticketData.bets.length > 1,
                avgCoeff: ticketData.bets && ticketData.bets.length === 1 ? (ticketData.bets[0].participant?.coeff || 0) : 0,
                potentialWinnings: ticketData.bets && ticketData.bets.length === 1 ? 
                    ((ticketData.bets[0].value || 0) * (ticketData.bets[0].participant?.coeff || 0)) : 0,
                isInCurrentRound: ticketData.roundId === this.currentRoundId
            };

            // Ajouter le nouveau ticket en haut du tableau (le plus récent en premier)
            const newRowHtml = createMyBetsTicketRow(formattedTicket);
            ticketsTableBody.insertAdjacentHTML('afterbegin', newRowHtml);

            // Limiter à 100 tickets affichés
            const rows = ticketsTableBody.querySelectorAll('tr[data-receipt-id]');
            if (rows.length > 100) {
                rows[rows.length - 1].remove();
            }

            // ✅ Mettre à jour les stats
            updateMyBetsStatsFromTicket(formattedTicket);
        };

        /* -------------------------
           Fonction pour supprimer un ticket directement du tableau my-bets (WebSocket)
        ------------------------- */
        const removeTicketFromMyBetsTable = (ticketId) => {
            if (!ticketsTableBody) return;

            const row = ticketsTableBody.querySelector(`tr[data-receipt-id="${ticketId}"]`);
            if (row) {
                row.remove();
                
                // Si le tableau est vide, afficher "Aucun ticket"
                if (ticketsTableBody.querySelectorAll('tr[data-receipt-id]').length === 0) {
                    ticketsTableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">Aucun ticket trouvé</td></tr>`;
                }
                
                // ✅ Mettre à jour les stats
                fetchMyBets(currentPage); // Refresh pour recalculer les stats correctement
            }
        };

        /* -------------------------
           Fonction pour mettre à jour les stats my-bets depuis un ticket ajouté
        ------------------------- */
        const updateMyBetsStatsFromTicket = (ticketData) => {
            // Mettre à jour le total des mises
            if (totalBetAmountEl) {
                const currentTotal = parseFloat(totalBetAmountEl.textContent.replace(' HTG', '').replace(/\s/g, '')) || 0;
                const newTotal = (currentTotal + (ticketData.totalAmount || 0)).toFixed(2);
                totalBetAmountEl.textContent = `${newTotal} HTG`;
            }
        };

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

            ticketsTableBody.innerHTML = tickets.map(ticket => createMyBetsTicketRow(ticket)).join('');
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

                // ✅ CORRECTION: Ajouter cache: 'no-cache' pour éviter le cache navigateur lors de la navigation
                const response = await fetch(`${API_URL}?${filters.toString()}`, {
                    cache: 'no-cache',
                    credentials: 'include'
                });
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

            // ✅ SÉCURITÉ: Vérifier si les paris sont autorisés
            const isLocked = (this.isRaceRunning || (this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs));
            const secondsLeft = Math.ceil(this.timerTimeLeft / 1000);
            
            tickets.forEach(t => {
                const hasPrize = t.prize && t.prize > 0;
                // Permettre l'annulation tant que le statut est "pending" ET que les paris ne sont pas verrouillés
                const canCancel = t.status === 'pending' && !isLocked;
                
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
                            onclick="window.printTicket && window.printTicket(${t.id || ''})"
                            title="Imprimer le ticket">
                            🖨️
                        </button>
                        
                        <!-- Bouton imprimer décaissement (visible pour tickets perdus après fin du round, ou tous les tickets terminés) -->
                        ${(t.status === 'lost' && isRoundFinished) || (t.status === 'won' || t.status === 'paid') ? `
                            <button class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-xs rounded" 
                                onclick="window.payTicket && window.payTicket(${t.id || ''})"
                                title="Imprimer le décaissement & Payer">
                                💰
                            </button>` : ''}
                        
                        <!-- Bouton annuler (seulement si round pas terminé ET paris non verrouillés) -->
                        ${canCancel ? `
                            <button class="px-2 py-1 bg-red-600 hover:bg-red-700 text-xs rounded" 
                                onclick="window.cancelTicket && window.cancelTicket(${t.id || ''})"
                                title="Annuler le ticket">
                                ❌
                            </button>` : (t.status === 'pending' && isLocked ? `
                            <button class="px-2 py-1 bg-red-600/50 text-red-300 text-xs rounded opacity-50 cursor-not-allowed" 
                                disabled
                                title="Annulation désactivée${this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs ? ` (démarrage dans ${secondsLeft}s)` : ' (course en cours)'}">
                                ❌
                            </button>` : '')}
                        
                        <!-- Bouton payer (visible pour tous les tickets gagnants, même si prize = 0) -->
                        ${t.status === 'won' ? `
                            <button class="px-2 py-1 bg-green-600 hover:bg-green-700 text-xs rounded" 
                                onclick="window.payTicket && window.payTicket(${t.id || ''})"
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
                `Confirmer le paiement du ticket #${id} ?<br><br>Le ticket sera marqué comme payé, puis le décaissement sera imprimé.`,
                async () => {
                    try {
                        // 1️⃣ Effectuer le paiement
                        const payRes = await fetch(`/api/v1/my-bets/pay/${id}`, { method: 'POST' });
                        const data = await payRes.json();
                        
                        if (!payRes.ok) {
                            throw new Error(data.error || data.message || "Erreur lors du paiement");
                        }
                        
                        // 2️⃣ ✅ IMPRESSION DU DÉCAISSEMENT APRÈS LE PAIEMENT
                        try {
                            const payoutRes = await fetch(`/api/v1/receipts/?action=payout&id=${id}`);
                            if (payoutRes.ok) {
                                const payoutHtml = await payoutRes.text();
                                console.log(`✅ [PAY-DASH] HTML du décaissement reçu pour le ticket #${id}`);
                                
                                // Essayer printJS d'abord
                                if (typeof window.printJS === 'function') {
                                    console.log(`✅ [PAY-DASH] printJS disponible, déclenchement de l'impression`);
                                    window.printJS({ printable: payoutHtml, type: 'raw-html' });
                                } else {
                                    // Fallback: créer une iframe et imprimer
                                    console.log(`⚠️ [PAY-DASH] printJS non disponible, utilisation fallback iframe`);
                                    const printWindow = window.open('', '', 'height=600,width=800');
                                    if (printWindow) {
                                        printWindow.document.write(payoutHtml);
                                        printWindow.document.close();
                                        // Attendre le chargement du contenu
                                        setTimeout(() => {
                                            printWindow.print();
                                            // Ne pas fermer la fenêtre immédiatement pour laisser le temps d'imprimer
                                            setTimeout(() => printWindow.close(), 500);
                                        }, 250);
                                    } else {
                                        console.warn('⚠️ [PAY-DASH] Impossible d\'ouvrir la fenêtre d\'impression');
                                    }
                                }
                            } else {
                                console.warn(`⚠️ [PAY-DASH] Impossible de récupérer le décaissement (HTTP ${payoutRes.status})`);
                            }
                        } catch (printErr) {
                            console.error('❌ [PAY-DASH] Erreur lors de l\'impression du décaissement:', printErr);
                            // Ne pas bloquer le processus si l'impression échoue
                        }
                        
                        // 3️⃣ Attendre que la DB soit mise à jour, puis rafraîchir la liste des tickets
                        setTimeout(() => fetchMyBets(currentPage), 300);
                        
                        // 4️⃣ Message de confirmation
                        const prizeAmount = data.data?.prize ? Number(data.data.prize).toFixed(2) : 'N/A';
                        window.app.alertModal(
                            `✅ Ticket #${id} payé avec succès (${prizeAmount} HTG).<br><br>Le décaissement a été envoyé à l'imprimante.`,
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
            
            // ✅ SÉCURITÉ: Vérifier si l'annulation est autorisée
            const bettingCheck = window.app.isBettingAllowed ? window.app.isBettingAllowed() : { allowed: true };
            if (!bettingCheck.allowed) {
                window.app.alertModal(`❌ ${bettingCheck.reason}. L'annulation n'est pas autorisée.`, 'error');
                return;
            }
            
            window.app.confirmModal(
                `Confirmer l'annulation du ticket #${id} ?`,
                async () => {
                    try {
                        console.log(`[CLIENT] Deleting receipt id=${id} -> /api/v1/receipts/?action=delete&id=${id}`);
                        const res = await fetch(`/api/v1/receipts/?action=delete&id=${id}`, { method: 'POST' });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || data.message || "Erreur lors de l'annulation");

                        // Rafraîchir immédiatement la liste des tickets
                        try { fetchMyBets(currentPage); } catch (e) { console.warn('fetchMyBets failed after delete:', e); }

                        window.app.alertModal(
                            `✅ Ticket #${id} annulé avec succès.`,
                            'success'
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
    window.cancelTicket = (id) => {
        if (typeof cancelTicket === 'function') return cancelTicket(id);
        if (window.app && typeof window.app.cancelTicket === 'function') return window.app.cancelTicket(id);
        console.error('cancelTicket function not available');
    };

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

        // Stocker les fonctions pour WebSocket
        this.myBetsFetchMyBets = fetchMyBets;
        this.myBetsAddTicketToTable = addTicketToMyBetsTable; // ✅ NOUVEAU: Ajouter directement un ticket
        this.myBetsRemoveTicketFromTable = removeTicketFromMyBetsTable; // ✅ NOUVEAU: Supprimer directement un ticket

        // ✅ CORRECTION: Chargement initial avec cache-busting pour forcer le rafraîchissement
        // Utiliser requestAnimationFrame pour s'assurer que le DOM est prêt
        requestAnimationFrame(() => {
            fetchMyBets(1);
        });

        console.log('✅ Mes Paris initialisé avec WebSocket en temps réel');
    }


    initBetting() {
        // Initialiser la page de pari
        console.log('Initialisation de la page de pari');
    }

    initAccount() {
        console.log('Initialisation de la page Account (caisse)');
        const self = this;

        // état propre à la page account
        this.accountState = this.accountState || {
            currentBalance: 0,
            totalReceipts: 0,
            totalPayouts: 0,
            currentRoundId: null,
            isRoundReady: false,
            ws: null,
            wsReconnectTimer: null,
            refreshInterval: null
        };

        const state = this.accountState;

        // Helper pour mettre à jour le statut visible du round
        function updateRoundStatusUI(rid) {
            const rs = document.getElementById('roundStatus');
            if (rs) rs.textContent = rid ? `(Round: ${rid})` : '(Round: aucun)';
        }

        async function refreshCashierDashboard() {
            try {
                console.log('🔄 [CASHIER-DASHBOARD] Rafraîchissement des données...');
                
                // 🚀 OPTIMISATION: Parallel API calls (Promise.all) instead of sequential
                const [moneyRes, myBetsRes] = await Promise.all([
                    fetch('/api/v1/money/', { credentials: 'include' }),
                    fetch('/api/v1/my-bets/?limit=1000&page=1', { credentials: 'include' })
                ]);

                // Check responses
                if (!moneyRes.ok) {
                    const errorText = await moneyRes.text();
                    console.error(`❌ [CASHIER-DASHBOARD] Money API HTTP ${moneyRes.status}:`, errorText);
                    throw new Error(`Money API HTTP ${moneyRes.status}`);
                }
                if (!myBetsRes.ok) {
                    const errorText = await myBetsRes.text();
                    console.error(`❌ [CASHIER-DASHBOARD] My-bets API HTTP ${myBetsRes.status}:`, errorText);
                    throw new Error(`My-bets API HTTP ${myBetsRes.status}`);
                }

                const moneyJson = await moneyRes.json();
                const myBetsJson = await myBetsRes.json();

                console.log('💰 [CASHIER-DASHBOARD] Money data:', moneyJson);
                console.log('🎫 [CASHIER-DASHBOARD] My-bets data:', myBetsJson);

                const moneyData = moneyJson.data || {};
                state.currentBalance = Number(moneyData.money || 0);
                state.totalReceipts = Number(moneyData.totalReceived || 0);
                state.totalPayouts = Number(moneyData.totalPayouts || 0);
                
                console.log(`💰 [CASHIER-DASHBOARD] Balance: ${state.currentBalance}, Received: ${state.totalReceipts}, Payouts: ${state.totalPayouts}`);

                const el = id => document.getElementById(id);
                
                // ✅ CORRECTION: Mise à jour avec logs pour débogage
                const currentBalanceEl = el('currentBalance');
                const totalReceiptsEl = el('totalReceipts');
                const totalPayoutsEl = el('totalPayouts');
                const netBalanceEl = el('netBalance');
                const systemBalanceEl = el('systemBalance');
                
                if (currentBalanceEl) {
                    currentBalanceEl.textContent = state.currentBalance.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] currentBalance mis à jour: ${state.currentBalance.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément currentBalance non trouvé');
                }
                
                if (totalReceiptsEl) {
                    totalReceiptsEl.textContent = state.totalReceipts.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] totalReceipts mis à jour: ${state.totalReceipts.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément totalReceipts non trouvé');
                }
                
                if (totalPayoutsEl) {
                    totalPayoutsEl.textContent = state.totalPayouts.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] totalPayouts mis à jour: ${state.totalPayouts.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément totalPayouts non trouvé');
                }
                
                const netBalance = state.totalReceipts - state.totalPayouts;
                if (netBalanceEl) {
                    netBalanceEl.textContent = netBalance.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] netBalance mis à jour: ${netBalance.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément netBalance non trouvé');
                }
                
                if (systemBalanceEl) {
                    systemBalanceEl.textContent = state.currentBalance.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] systemBalance mis à jour: ${state.currentBalance.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément systemBalance non trouvé');
                }

                // tickets
                const myBetsData = myBetsJson.data || {};
                const tickets = myBetsData.tickets || [];
                
                console.log(`🎫 [CASHIER-DASHBOARD] ${tickets.length} ticket(s) récupéré(s)`);

                const activeTickets = tickets.filter(t => t.status === 'pending');
                const wonTickets = tickets.filter(t => t.status === 'won');
                const paidTickets = tickets.filter(t => t.status === 'paid');
                
                console.log(`🎫 [CASHIER-DASHBOARD] Tickets: ${activeTickets.length} actifs, ${wonTickets.length} gagnants, ${paidTickets.length} payés`);

                const activeTicketsCountEl = el('activeTicketsCount');
                const wonTicketsCountEl = el('wonTicketsCount');
                const wonTicketsAmountEl = el('wonTicketsAmount');
                const paidTicketsCountEl = el('paidTicketsCount');
                const paidTicketsAmountEl = el('paidTicketsAmount');
                
                if (activeTicketsCountEl) {
                    activeTicketsCountEl.textContent = activeTickets.length;
                    console.log(`✅ [CASHIER-DASHBOARD] activeTicketsCount mis à jour: ${activeTickets.length}`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément activeTicketsCount non trouvé');
                }
                
                if (wonTicketsCountEl) {
                    wonTicketsCountEl.textContent = wonTickets.length;
                    console.log(`✅ [CASHIER-DASHBOARD] wonTicketsCount mis à jour: ${wonTickets.length}`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément wonTicketsCount non trouvé');
                }
                
                const wonTicketsAmount = wonTickets.reduce((s, t) => s + (Number(t.prize) || 0), 0);
                if (wonTicketsAmountEl) {
                    wonTicketsAmountEl.textContent = wonTicketsAmount.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] wonTicketsAmount mis à jour: ${wonTicketsAmount.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément wonTicketsAmount non trouvé');
                }
                
                if (paidTicketsCountEl) {
                    paidTicketsCountEl.textContent = paidTickets.length;
                    console.log(`✅ [CASHIER-DASHBOARD] paidTicketsCount mis à jour: ${paidTickets.length}`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément paidTicketsCount non trouvé');
                }
                
                const paidTicketsAmount = paidTickets.reduce((s, t) => s + (Number(t.prize) || 0), 0);
                if (paidTicketsAmountEl) {
                    paidTicketsAmountEl.textContent = paidTicketsAmount.toFixed(2) + ' HTG';
                    console.log(`✅ [CASHIER-DASHBOARD] paidTicketsAmount mis à jour: ${paidTicketsAmount.toFixed(2)} HTG`);
                } else {
                    console.warn('⚠️ [CASHIER-DASHBOARD] Élément paidTicketsAmount non trouvé');
                }

                // history
                const historyEl = document.getElementById('cashierOperationsHistory');
                if (historyEl) {
                    const recent = tickets.slice(0, 10);
                    if (recent.length === 0) {
                        historyEl.innerHTML = '<div class="p-2 text-center text-slate-500">Aucune opération récente</div>';
                    } else {
                        historyEl.innerHTML = recent.map(t => {
                            const time = t.created_time ? new Date(t.created_time).toLocaleString('fr-FR') : '';
                            const status = (t.status || '').toUpperCase();
                            const total = (Number(t.total_amount) || (t.bets && t.bets.reduce((s, b) => s + (Number(b.value)||0), 0)) || 0).toFixed(2);
                            return `<div class="p-2 border-b border-slate-600 flex justify-between items-center">
                                        <div class="text-sm text-slate-200">Ticket #${t.id} <span class="text-xs text-slate-400">${time}</span></div>
                                        <div class="text-right">
                                            <div class="text-sm font-medium">${total} HTG</div>
                                            <div class="text-xs text-slate-400">${status}</div>
                                        </div>
                                    </div>`;
                        }).join('');
                    }
                }

            } catch (err) {
                console.error('❌ Erreur refresh cashier dashboard:', err);
                const errorMsg = document.getElementById('currentBalance');
                if (errorMsg) {
                    errorMsg.textContent = 'Erreur DB';
                    errorMsg.classList.add('text-red-400');
                }
            }
        }

        async function fetchCurrentRound() {
            try {
                const res = await fetch('/api/v1/rounds/', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get' })
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                const payload = json.data || {};
                const rid = payload.id || (payload.currentRound && payload.currentRound.id) || (payload.game && payload.game.id) || null;
                state.currentRoundId = rid;
                state.isRoundReady = !!rid;
                updateRoundStatusUI(rid);
            } catch (err) {
                console.warn('[SYNC] fetchCurrentRound failed:', err.message);
                state.currentRoundId = null;
                state.isRoundReady = false;
                updateRoundStatusUI(null);
            }
        }

        function handleWsEvent(payload) {
            if (!payload || !payload.event) return;
            switch (payload.event) {
                case 'receipt_added':
                case 'receipt_deleted':
                case 'receipt_cancelled':
                case 'receipt_paid':
                    refreshCashierDashboard();
                    break;
                case 'new_round':
                case 'race_start':
                    state.currentRoundId = payload.roundId || null;
                    state.isRoundReady = !!state.currentRoundId;
                    updateRoundStatusUI(state.currentRoundId);
                    refreshCashierDashboard();
                    break;
                case 'race_end':
                    state.currentRoundId = null;
                    state.isRoundReady = false;
                    updateRoundStatusUI(null);
                    refreshCashierDashboard();
                    break;
                case 'money_update':
                    if (payload.data) {
                        if (typeof payload.data.cashBalance !== 'undefined') {
                            state.currentBalance = Number(payload.data.cashBalance || 0);
                            const el = document.getElementById('currentBalance'); if (el) el.textContent = state.currentBalance.toFixed(2) + ' HTG';
                            const el2 = document.getElementById('systemBalance'); if (el2) el2.textContent = state.currentBalance.toFixed(2) + ' HTG';
                        }
                        if (typeof payload.data.totalReceived !== 'undefined') {
                            state.totalReceipts = Number(payload.data.totalReceived || 0);
                            const el = document.getElementById('totalReceipts'); if (el) el.textContent = state.totalReceipts.toFixed(2) + ' HTG';
                        }
                        if (typeof payload.data.totalPayouts !== 'undefined') {
                            state.totalPayouts = Number(payload.data.totalPayouts || 0);
                            const el = document.getElementById('totalPayouts'); if (el) el.textContent = state.totalPayouts.toFixed(2) + ' HTG';
                        }
                        const netEl = document.getElementById('netBalance'); if (netEl) netEl.textContent = (state.totalReceipts - state.totalPayouts).toFixed(2) + ' HTG';
                    }
                    break;
                default:
                    break;
            }
        }

        // ✅ CORRECTION: Ne pas créer une connexion WebSocket séparée
        // Utiliser la connexion WebSocket principale de app.js qui est déjà gérée
        // La fonction connectWebSocket locale est supprimée car elle causait des erreurs
        // avec une URL hardcodée incorrecte (ws://localhost:8081)
        
        // ✅ CORRECTION: Utiliser la connexion WebSocket principale si disponible
        // Les événements WebSocket sont déjà gérés par this.handleWebSocketMessage()
        // qui appelle refreshCashierDashboard() pour les événements pertinents

        // ✅ NOUVEAU: Charger l'historique des gagnants
        async function loadWinnersHistory() {
            try {
                const res = await fetch('/api/v1/winners/recent?limit=10');
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const json = await res.json();
                const winners = json.data?.winners || [];
                
                const winnersContainer = document.getElementById('winnersHistory');
                if (!winnersContainer) return;

                if (winners.length === 0) {
                    winnersContainer.innerHTML = '<div class="p-3 text-center text-slate-400 text-sm">Aucun gagnant enregistré</div>';
                    return;
                }

                // Formater la date
                function formatDate(dateString) {
                    if (!dateString) return 'N/A';
                    const date = new Date(dateString);
                    return date.toLocaleDateString('fr-FR', { 
                        day: '2-digit', 
                        month: '2-digit', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }

                winnersContainer.innerHTML = winners.map((winner, index) => {
                    const prize = parseFloat(winner.prize || 0).toFixed(2);
                    return `
                        <div class="bg-slate-800/50 rounded-lg p-3 border border-slate-600/50 hover:border-slate-500 transition-colors">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 flex items-center justify-center border border-yellow-500/30">
                                        <span class="text-yellow-400 font-bold text-sm">#${index + 1}</span>
                                    </div>
                                    <div>
                                        <div class="font-semibold text-white">
                                            <span class="text-yellow-400">№${winner.number}</span> ${winner.name || 'N/A'}
                                        </div>
                                        <div class="text-xs text-slate-400">
                                            Round #${winner.id || 'N/A'} • ${formatDate(winner.created_at)}
                                        </div>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="text-lg font-bold text-green-400">${prize} HTG</div>
                                    <div class="text-xs text-slate-500">Gain total</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                console.log(`✅ [WINNERS-HISTORY] ${winners.length} gagnants chargés`);
            } catch (err) {
                console.error('❌ [WINNERS-HISTORY] Erreur lors du chargement:', err);
                const winnersContainer = document.getElementById('winnersHistory');
                if (winnersContainer) {
                    winnersContainer.innerHTML = '<div class="p-3 text-center text-red-400 text-sm">Erreur lors du chargement des gagnants</div>';
                }
            }
        }

        // Charger l'historique au démarrage
        loadWinnersHistory();

        // event listeners UI
        const refreshBtn = document.getElementById('refreshCashierBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => {
            refreshCashierDashboard();
            loadWinnersHistory(); // Recharger aussi l'historique des gagnants
        });
        const validateBtn = document.getElementById('validateBalanceBtn');
        if (validateBtn) validateBtn.addEventListener('click', () => { alert('✓ Réconciliation validée. Nouvelle caisse: ' + (document.getElementById('physicalBalance')?.value || '0') + ' HTG'); document.getElementById('physicalBalance').value = ''; refreshCashierDashboard(); });
        const physical = document.getElementById('physicalBalance'); if (physical) physical.addEventListener('input', () => { const v = parseFloat(physical.value)||0; const discrepancy = v - state.currentBalance; const alertEl = document.getElementById('discrepancyAlert'); if (Math.abs(discrepancy) > 0.01) { document.getElementById('discrepancyAmount').textContent = (discrepancy>0?'+':'')+discrepancy.toFixed(2)+' HTG'; alertEl.classList.remove('hidden'); } else { alertEl.classList.add('hidden'); } });

        // ✅ SUPPRIMÉ: Handlers pour opérations caisse (section remplacée par historique des gagnants)
        // Les boutons "Ouvrir le tiroir", "Fermer la caisse", "Dépôt en banque", "Retrait/Remise" 
        // ont été remplacés par l'historique des gagnants des 10 dernières courses dans account.html

        // ✅ Exposer refreshCashierDashboard pour les handlers WebSocket
        this.refreshCashierDashboard = refreshCashierDashboard;
        
        // initial load + periodic refresh
        refreshCashierDashboard();
        // ✅ OPTIMISATION: Supprimé setInterval - refresh via WebSocket events uniquement
        // Les événements receipt_added, receipt_paid, money_update déclenchent déjà refreshCashierDashboard
        
        // ✅ CORRECTION: Ne pas créer de connexion WebSocket séparée
        // La connexion WebSocket principale de app.js est déjà gérée par connectWebSocket()
        // et les événements sont traités par handleWebSocketMessage() qui appelle refreshCashierDashboard()
        
        // ✅ CORRECTION: S'assurer que la connexion WebSocket principale est active
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            // Si la connexion principale n'est pas active, la démarrer
            if (typeof this.connectWebSocket === 'function') {
                this.connectWebSocket();
            }
        }
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
        const mobileOpenBtn = document.getElementById('mobileOpenBtn');
        if (mobileOpenBtn) {
            mobileOpenBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.toggle('hidden');
                }
            });
        }

        // Déconnexion
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }
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

                    // Convertir b.value (système, ×100) en valeur publique
                    let publicValue = b.value || 0;
                    
                    // Si Currency.systemToPublic existe, l'utiliser; sinon diviser par 100
                    if (typeof window.Currency !== 'undefined' && typeof window.Currency.systemToPublic === 'function') {
                        publicValue = window.Currency.systemToPublic(publicValue);
                        // systemToPublic peut retourner un objet avec toString(), extraire la valeur numérique
                        if (typeof publicValue === 'object' && publicValue.toNumber) {
                            publicValue = publicValue.toNumber();
                        } else if (typeof publicValue === 'object' && publicValue.toString) {
                            publicValue = Number(publicValue.toString());
                        } else {
                            publicValue = Number(publicValue);
                        }
                    } else {
                        // Fallback: diviser par 100 (conversion système -> public)
                        publicValue = Number(publicValue) / 100;
                    }

                    // Formater avec la bonne précision décimale
                    const visibleDigits = (window.Currency && window.Currency.visibleDigits) || 2;
                    const placeholderVal = Number(publicValue || 0).toFixed(visibleDigits);
                    
                    return `
                        <div class="mb-2">
                            <label style="display:block;font-weight:600;margin-bottom:4px;">Pari ${idx+1}: ${participantLabel}${coeffLabel}</label>
                            <input data-bet-index="${idx}" data-default-value="${placeholderVal}" class="rebet-amount" type="number" step="0.01" min="0" value="" placeholder="${placeholderVal}" style="width:100%;padding:6px;border-radius:4px;border:1px solid #333;background:#0f1724;color:#fff;" />
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
                                // Read user input; if empty, use the data-default-value attribute
                                let raw = inp.value;
                                if (!raw || raw === '') {
                                    // Récupérer la valeur par défaut stockée dans data-default-value
                                    raw = inp.getAttribute('data-default-value') || '0';
                                }
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
                            // ✅ SÉCURITÉ: Vérifier si le placement de paris est autorisé
                            const bettingCheck = this.isBettingAllowed ? this.isBettingAllowed() : { allowed: true };
                            if (!bettingCheck.allowed) {
                                this.alertModal(`❌ ${bettingCheck.reason}. Le placement de paris n'est pas autorisé.`, 'error');
                                return;
                            }
                            
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

    // =================================================================
    // ===   BET FRAME OVERLAY + AUTO-FINISH (cashier perf)           ===
    // =================================================================

    initBetFrameOverlay() {
        // Le dashboard contient l'iframe #betFrame + overlay. D'autres pages non.
        const overlay = document.getElementById('betFrameOverlay');
        if (!overlay) return;
        this.cancelBetFrameCountdown();
    }

    cancelBetFrameCountdown() {
        if (this.betFrameState && this.betFrameState.countdownInterval) {
            clearInterval(this.betFrameState.countdownInterval);
            this.betFrameState.countdownInterval = null;
        }
        const progressBar = document.getElementById('betLaunchProgressBar');
        const timerEl = document.getElementById('betLaunchTimer');
        if (progressBar) progressBar.style.width = '0%';
        if (timerEl) timerEl.textContent = '';
    }

    reloadBetFrame() {
        const iframe = document.getElementById('betFrame');
        if (!iframe) return;
        const base = iframe.getAttribute('src')?.split('?')[0] || '/bet_frame';
        iframe.setAttribute('src', base + '?t=' + Date.now());
    }

    setBetFrameDisabled(disabled = true, message, durationMs, triggerFinishOnEnd = false) {
        const overlay = document.getElementById('betFrameOverlay');
        const textEl = document.getElementById('betFrameOverlayText');
        if (!overlay) return;

        if (message && textEl) textEl.textContent = message;

        if (disabled) {
            this.cancelBetFrameCountdown();
            overlay.classList.remove('hidden');
            overlay.classList.remove('opacity-0');
            overlay.classList.add('opacity-100');
            if (durationMs && durationMs > 0) {
                this.startBetFrameCountdown(durationMs, triggerFinishOnEnd);
            }
        } else {
            this.cancelBetFrameCountdown();
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }

    startBetFrameCountdown(durationMs, triggerFinishOnEnd) {
        if (!durationMs || durationMs <= 0) return;
        const progressBar = document.getElementById('betLaunchProgressBar');
        const timerEl = document.getElementById('betLaunchTimer');
        if (!progressBar || !timerEl) return;

        this.betFrameState.countdownStart = Date.now();
        this.betFrameState.countdownDuration = durationMs;
        progressBar.style.width = '0%';
        timerEl.textContent = `${Math.ceil(durationMs / 1000)}s`;

        this.betFrameState.countdownInterval = setInterval(async () => {
            const elapsed = Date.now() - this.betFrameState.countdownStart;
            const pct = Math.min(100, (elapsed / this.betFrameState.countdownDuration) * 100);
            progressBar.style.width = pct + '%';
            const remainingSec = Math.max(0, Math.ceil((this.betFrameState.countdownDuration - elapsed) / 1000));
            timerEl.textContent = `${remainingSec}s`;

            if (elapsed >= this.betFrameState.countdownDuration) {
                this.cancelBetFrameCountdown();
                if (triggerFinishOnEnd) {
                    await this.autoFinishRace();
                }
            }
        }, 100);
    }

    async autoFinishRace() {
        if (this.betFrameState.finishInFlight) return;
        this.betFrameState.finishInFlight = true;
        try {
            const r = await fetch('/api/v1/rounds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'finish' })
            });
            const data = await r.json().catch(() => ({}));
            if (this.debugWs) console.log('⏱️ [AUTO-CLICK] action=finish envoyé:', data);
            this.reloadBetFrame();
        } catch (err) {
            console.error('❌ [AUTO-CLICK] Erreur:', err?.message || err);
        } finally {
            setTimeout(() => { this.betFrameState.finishInFlight = false; }, 1500);
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
            // ✅ Compat: certains modules legacy regardent window.ws
            window.ws = this.ws;
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
        if (this.debugWs) console.log('📨 WebSocket message reçu:', data.event);

        switch (data.event) {
            case 'connected':
                console.log('🔌 WebSocket connecté, round actuel:', data.roundId);
                // ✅ CORRECTION: Synchroniser currentRoundId
                if (data.roundId) {
                    this.currentRoundId = data.roundId;
                    this.betFrameState.currentRoundId = data.roundId;
                    const currentRoundEl = document.getElementById('currentRound');
                    const currentRoundTimerEl = document.getElementById('currentRoundTimer');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                    if (currentRoundTimerEl) currentRoundTimerEl.textContent = `Round ${data.roundId}`;
                }
                
                // ✅ SÉCURITÉ: Synchroniser l'état de verrouillage depuis le serveur
                if (data.timerTimeLeft !== undefined) {
                    this.timerTimeLeft = data.timerTimeLeft;
                    this.bettingLocked = this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs;
                }
                if (data.isRaceRunning !== undefined) {
                    this.isRaceRunning = data.isRaceRunning;
                    if (data.isRaceRunning) {
                        this.bettingLocked = true;
                    }
                }
                
                // Synchroniser le timer si disponible
                if (this.currentPage === 'dashboard' && data.timerTimeLeft && data.timerTimeLeft > 0) {
                    const totalDuration = data.timerTotalDuration || 60000;
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
                // ✅ Overlay bet_frame (dashboard)
                if (this.currentPage === 'dashboard') {
                    const roundId = data.roundId || 'N/A';
                    if (data.isRaceRunning && data.raceStartTime) {
                        // Course en cours: overlay (sans auto-finish)
                        const elapsed = Date.now() - data.raceStartTime;
                        const remaining = Math.max(0, 10000 - elapsed);
                        this.betFrameState.currentRoundId = roundId;
                        this.setBetFrameDisabled(true, `Course en cours — Round ${roundId}`, remaining, false);
                        // Arrêter le timer pendant la course
                        if (this.dashboardArreterTimer) this.dashboardArreterTimer();
                    } else if (data.roundId) {
                        this.betFrameState.currentRoundId = data.roundId;
                    }
                }
                // ✅ OPTIMISATION: Rafraîchissement direct (pas de setTimeout)
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    requestAnimationFrame(() => this.dashboardRefreshTickets());
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    requestAnimationFrame(() => this.myBetsFetchMyBets(1));
                }
                
                // ✅ OPTIMISATION: Mise à jour directe des boutons
                if (this.updateBettingButtonsState) {
                    requestAnimationFrame(() => this.updateBettingButtonsState());
                }
                break;

            case 'timer_update':
                // ✅ SÉCURITÉ: Mettre à jour le temps restant pour la vérification de sécurité
                if (data.timer && data.timer.timeLeft !== undefined) {
                    this.timerTimeLeft = data.timer.timeLeft;
                    // Mettre à jour l'état de verrouillage
                    this.bettingLocked = this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs;
                }
                
                // Mettre à jour le timer si on est sur le dashboard
                if (this.currentPage === 'dashboard' && data.timer && data.timer.timeLeft >= 0) {
                    // Resync le timer local avec le serveur
                    if (this.dashboardDemarrerTimer) {
                        this.dashboardDemarrerTimer(data.timer.timeLeft, data.timer.totalDuration || 60000);
                    }
                    
                    // ✅ SÉCURITÉ: Mettre à jour l'affichage des boutons selon l'état de verrouillage
                    if (this.updateBettingButtonsState) {
                        this.updateBettingButtonsState();
                    }
                }
                
                // ✅ SÉCURITÉ: Mettre à jour les boutons aussi sur my-bets
                if (this.currentPage === 'my-bets' && this.updateBettingButtonsState) {
                    this.updateBettingButtonsState();
                }
                break;

            case 'reload_page':
                console.log('🔄 Rechargement de la page demandé par le serveur (reason: ' + (data.reason || 'unknown') + ')');
                // Recharger la page après un court délai pour permettre au message d'être traité
                setTimeout(() => {
                    window.location.reload();
                }, 500);
                break;

            case 'new_round':
                console.log('🆕 Nouveau tour:', data.roundId || data.game?.id);
                // ✅ CORRECTION: Synchroniser currentRoundId
                const newRoundId = data.roundId || data.game?.id || data.currentRound?.id;
                if (newRoundId) {
                    this.currentRoundId = newRoundId;
                    this.betFrameState.currentRoundId = newRoundId;
                }
                
                // Réinitialiser l'état de la course
                this.isRaceRunning = false;
                this.bettingLocked = false; // Les paris sont ouverts pour le nouveau round
                
                // ✅ SÉCURITÉ: Mettre à jour le temps restant si disponible
                if (data.timer && data.timer.timeLeft !== undefined) {
                    this.timerTimeLeft = data.timer.timeLeft;
                    this.bettingLocked = this.timerTimeLeft > 0 && this.timerTimeLeft <= this.bettingLockDurationMs;
                }
                
                // ✅ OPTIMISATION: Mise à jour directe
                if (this.updateBettingButtonsState) {
                    requestAnimationFrame(() => this.updateBettingButtonsState());
                }
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
                // ✅ OPTIMISATION: Démarrer le timer directement (requestAnimationFrame si nécessaire)
                if (this.currentPage === 'dashboard' && data.timer && data.timer.timeLeft > 0) {
                    if (this.dashboardDemarrerTimer) {
                        requestAnimationFrame(() => {
                            if (this.dashboardDemarrerTimer) {
                                this.dashboardDemarrerTimer(data.timer.timeLeft, data.timer.totalDuration || 60000);
                            }
                        });
                    }
                } else if (this.currentPage === 'dashboard' && data.nextRoundStartTime) {
                    // Calculer le temps restant depuis nextRoundStartTime
                    const timeLeft = Math.max(0, data.nextRoundStartTime - Date.now());
                    if (timeLeft > 0 && this.dashboardDemarrerTimer) {
                        const totalDuration = data.timer?.totalDuration || 60000;
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
                // ✅ OPTIMISATION: Mise à jour directe
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets();
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1);
                }
                // Notification
                this.showToast(`🆕 Nouveau round #${newRoundId}`, 'success');
                break;

            case 'race_start':
                console.log('🏁 Course démarrée - Round:', data.roundId);
                
                // ✅ MET À JOUR LE GAMEMANAGER AVEC LES DONNÉES DU WEBSOCKET
                // Cela garantit que le movie screen aura les données correctes
                // ✅ CORRECTION: Vérifier que client existe avant de l'utiliser
                if (data.currentRound && typeof window !== 'undefined' && window.client && window.client._context && window.client._context.getGameManager) {
                    try {
                        window.client._context.getGameManager().updateGameFromWebSocket(data.currentRound);
                        console.log('✅ GameManager mis à jour avec race_start data');
                    } catch (err) {
                        console.warn('⚠️ Erreur mise à jour GameManager:', err.message);
                    }
                }
                
                // Mettre à jour l'état de la course
                this.isRaceRunning = true;
                this.bettingLocked = true; // Les paris sont fermés pendant la course
                
                // ✅ SÉCURITÉ: Mettre à jour l'état des boutons
                if (this.updateBettingButtonsState) {
                    this.updateBettingButtonsState();
                }
                
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
                
                // ✅ CORRECTION: MET À JOUR LE GAMEMANAGER AVEC LES DONNÉES FINALES DU ROUND
                // Cela garantit que le finish screen affichera les données correctes
                // ✅ CORRECTION: Vérifier que client existe avant de l'utiliser
                if (data.currentRound && typeof window !== 'undefined' && window.client && window.client._context && window.client._context.getGameManager) {
                    try {
                        window.client._context.getGameManager().updateGameFromWebSocket(data.currentRound);
                        console.log('✅ GameManager mis à jour avec race_end data (winner inclus)');
                    } catch (err) {
                        console.warn('⚠️ Erreur mise à jour GameManager:', err.message);
                    }
                }
                
                // Note: betFrameOverlay reste visible jusqu'à new_round (géré par main.js)
                // Réinitialiser l'état de la course
                this.isRaceRunning = false;
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                // ✅ Mise à jour IMMÉDIATE - les statuts sont déjà mis à jour via receipt_status_updated
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets(); // Pas de setTimeout - mise à jour immédiate
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1); // Pas de setTimeout - mise à jour immédiate
                }
                if (this.currentPage === 'account' && this.refreshCashierDashboard) {
                    this.refreshCashierDashboard(); // Mise à jour cashier immédiate
                }
                // Notification avec plus d'infos
                const winnerInfo = data.winner ? `${data.winner.name} (N°${data.winner.number})` : 'N/A';
                const totalPrize = data.totalPrize || data.prize || 0;
                this.showToast(`🏆 Round #${data.roundId || 'N/A'} terminé ! Gagnant: ${winnerInfo} | Total gains: ${totalPrize.toFixed(2)} HTG`, 'success');
                break;

            case 'receipt_status_updated':
            case 'receipts_status_updated':
                // ✅ NOUVEAU: Mise à jour immédiate des statuts de receipts après fin de round
                console.log('🎫 Mise à jour des statuts de tickets - Round:', data.roundId, 'Événement:', data.event);
                
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                
                // ✅ Mise à jour IMMÉDIATE sans délai pour synchronisation temps réel
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets(); // Pas de setTimeout - mise à jour immédiate
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1); // Pas de setTimeout - mise à jour immédiate
                }
                if ((this.currentPage === 'account' || this.currentPage === 'cashier-account') && this.refreshCashierDashboard) {
                    this.refreshCashierDashboard(); // Mise à jour cashier immédiate
                }
                
                // Notification pour les tickets gagnants
                if (data.event === 'receipt_status_updated' && data.status === 'won') {
                    const prizeAmount = data.prize ? Number(data.prize).toFixed(2) : '0.00';
                    this.showToast(`🏆 Ticket #${data.receiptId} a gagné ! (${prizeAmount} HTG) - Round #${data.roundId || 'N/A'}`, 'success');
                }
                break;
                
            case 'receipt_added':
                // ✅ CORRECTION: Invalider le cache et forcer un refresh pour garantir la synchronisation
                console.log('🎫 Nouveau ticket ajouté - Round:', data.roundId, 'Ticket ID:', data.receiptId);
                
                // ✅ CRITIQUE: Invalider le cache des tickets pour forcer un refresh depuis l'API
                // Le ticket peut ne pas être encore en DB, donc on attend un peu avant de rafraîchir
                if (this.currentPage === 'dashboard' || this.currentPage === 'my-bets') {
                    // Attendre un court délai pour que le ticket soit persisté en DB
                    setTimeout(() => {
                        // Invalider le cache et forcer un refresh
                        if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                            console.log('🔄 [DASHBOARD] Refresh forcé après receipt_added');
                            this.dashboardRefreshTickets(true); // force = true pour bypasser le cache
                        } else if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                            console.log('🔄 [MY-BETS] Refresh forcé après receipt_added');
                            // Récupérer la page actuelle et forcer le refresh
                            const currentPage = document.getElementById('currentPage')?.textContent || 1;
                            this.myBetsFetchMyBets(parseInt(currentPage, 10)); // Refresh depuis l'API
                        }
                    }, 800); // Attendre 800ms pour que le ticket soit persisté en DB (augmenté pour plus de sécurité)
                }
                
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                
                // ✅ OPTIONNEL: Essayer d'ajouter directement le ticket au DOM (si les données sont complètes)
                // Cela permet une mise à jour immédiate pendant que l'API se synchronise
                const ticketData = {
                    id: data.receiptId || data.receipt?.id,
                    receiptId: data.receiptId || data.receipt?.id,
                    roundId: data.roundId,
                    status: data.status || 'pending',
                    prize: data.prize || 0,
                    bets: data.bets || data.receipt?.bets || [],
                    totalAmount: data.totalAmount || (data.receipt?.bets ? data.receipt.bets.reduce((sum, b) => sum + (Number(b.value) || 0), 0) / 100 : 0),
                    created_time: data.created_time || data.receipt?.created_time || new Date().toISOString(),
                    date: data.date || data.created_time || data.receipt?.created_time || new Date().toISOString(),
                    user_id: data.receipt?.user_id || data.user_id || null
                };
                
                // ✅ Mise à jour DIRECTE du DOM pour le dashboard (si les données sont complètes)
                if (this.currentPage === 'dashboard' && ticketData.id && ticketData.bets && ticketData.bets.length > 0) {
                    if (this.dashboardAddTicketToTable) {
                        try {
                            this.dashboardAddTicketToTable(ticketData);
                            console.log('✅ [DASHBOARD] Ticket ajouté directement au DOM');
                        } catch (err) {
                            console.warn('⚠️ [DASHBOARD] Erreur ajout direct ticket:', err);
                        }
                    }
                }
                
                // ✅ Mise à jour DIRECTE du DOM pour my-bets (si les données sont complètes)
                if (this.currentPage === 'my-bets' && ticketData.id && ticketData.bets && ticketData.bets.length > 0) {
                    // Vérifier si le ticket appartient à l'utilisateur connecté
                    // Note: Le serveur devrait déjà filtrer, mais on peut aussi vérifier côté client
                    if (this.myBetsAddTicketToTable) {
                        try {
                            this.myBetsAddTicketToTable(ticketData);
                            console.log('✅ [MY-BETS] Ticket ajouté directement au DOM');
                        } catch (err) {
                            console.warn('⚠️ [MY-BETS] Erreur ajout direct ticket:', err);
                        }
                    } else {
                        // Fallback: refresh complet
                        if (this.myBetsFetchMyBets) {
                            this.myBetsFetchMyBets(1);
                        }
                    }
                }
                
                // ✅ Pour account, refresh complet
                if (this.currentPage === 'account' && this.refreshCashierDashboard) {
                    this.refreshCashierDashboard();
                }
                
                // Notification
                this.showToast(`✅ Ticket #${data.receiptId || 'N/A'} créé`, 'success');
                break;

            case 'receipt_deleted':
            case 'receipt_cancelled':
                // ✅ OPTIMISATION: Supprimer directement le ticket du tableau sans appel API
                console.log('🎫 Ticket supprimé - Round:', data.roundId, 'Ticket ID:', data.receiptId);
                
                // ✅ Mise à jour DIRECTE du DOM pour le dashboard
                if (this.currentPage === 'dashboard') {
                    if (this.dashboardRemoveTicketFromTable) {
                        this.dashboardRemoveTicketFromTable(data.receiptId);
                    } else {
                        // Fallback: refresh complet si la fonction n'est pas disponible
                        if (this.dashboardRefreshTickets) {
                            this.dashboardRefreshTickets();
                        }
                    }
                }
                
                // ✅ Mise à jour DIRECTE du DOM pour my-bets
                if (this.currentPage === 'my-bets') {
                    if (this.myBetsRemoveTicketFromTable) {
                        this.myBetsRemoveTicketFromTable(data.receiptId);
                    } else {
                        // Fallback: refresh complet
                        if (this.myBetsFetchMyBets) {
                            this.myBetsFetchMyBets(1);
                        }
                    }
                }
                
                // ✅ Pour account, refresh complet
                if (this.currentPage === 'account' && this.refreshCashierDashboard) {
                    this.refreshCashierDashboard();
                }
                
                // Notification
                if (data.event === 'receipt_cancelled') {
                    this.showToast(`❌ Ticket #${data.receiptId} annulé - Round #${data.roundId || 'N/A'}`, 'info');
                }
                break;

            case 'ticket_update':
            case 'receipt_paid':
                console.log('🎫 Mise à jour des tickets - Round:', data.roundId, 'Événement:', data.event);
                // Mettre à jour le round si nécessaire
                if (data.roundId) {
                    const currentRoundEl = document.getElementById('currentRound');
                    if (currentRoundEl) currentRoundEl.textContent = data.roundId;
                }
                // ✅ Mise à jour IMMÉDIATE sans délai pour synchronisation temps réel
                if (this.currentPage === 'dashboard' && this.dashboardRefreshTickets) {
                    this.dashboardRefreshTickets(); // Refresh complet pour les mises à jour de statut
                }
                if (this.currentPage === 'my-bets' && this.myBetsFetchMyBets) {
                    this.myBetsFetchMyBets(1); // Pas de setTimeout - mise à jour immédiate
                }
                if ((this.currentPage === 'account' || this.currentPage === 'cashier-account') && this.refreshCashierDashboard) {
                    this.refreshCashierDashboard(); // Mise à jour cashier immédiate
                }
                // Notifications spéciales
                if (data.event === 'receipt_paid') {
                    const prizeAmount = data.prize ? Number(data.prize).toFixed(2) : 'N/A';
                    this.showToast(`💰 Ticket #${data.receiptId} payé (${prizeAmount} HTG) - Round #${data.roundId || 'N/A'}`, 'success');
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
        window.cancelTicket = (id) => {
            if (window.app && typeof window.app.cancelTicket === 'function') return window.app.cancelTicket(id);
            if (typeof cancelTicket === 'function') return cancelTicket(id);
            console.error('cancelTicket function not available');
        };
        // Impression centralisée via printJS (printJS est garanti)
        window.printTicket = async (id) => {
            try {
                const res = await fetch(`/api/v1/receipts/?action=print&id=${id}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const html = await res.text();
                
                console.log(`✅ [PRINT] HTML du ticket #${id} reçu`);
                
                // Essayer printJS d'abord
                if (typeof window.printJS === 'function') {
                    console.log(`✅ [PRINT] printJS disponible, déclenchement de l'impression`);
                    window.printJS({ printable: html, type: 'raw-html' });
                } else {
                    // Fallback: créer une fenêtre et imprimer
                    console.log(`⚠️ [PRINT] printJS non disponible, utilisation fallback iframe`);
                    const printWindow = window.open('', '', 'height=600,width=800');
                    if (printWindow) {
                        printWindow.document.write(html);
                        printWindow.document.close();
                        // Attendre le chargement du contenu
                        setTimeout(() => {
                            printWindow.print();
                            // Ne pas fermer la fenêtre immédiatement pour laisser le temps d'imprimer
                            setTimeout(() => printWindow.close(), 500);
                        }, 250);
                    } else {
                        throw new Error('Impossible d\'ouvrir la fenêtre d\'impression');
                    }
                }
            } catch (err) {
                console.error('❌ [PRINT] Erreur printTicket:', err);
                if (window.app && typeof window.app.showToast === 'function') {
                    window.app.showToast(err.message || 'Erreur impression', 'error');
                } else {
                    alert('Erreur impression: ' + (err.message || 'Inconnu'));
                }
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