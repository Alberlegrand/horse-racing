/**
 * Gestionnaire de compte de caisse
 * Gère le solde NET en temps réel avec auto-refresh
 */

class CashierAccountManager {
  constructor() {
    this.currentAccount = null;
    this.currentBalance = 0;
    this.accountStatus = 'closed';
    this.transactions = [];
    this.isLoading = false;
    this.autoRefreshInterval = null;
    this.updateListeners = [];
  }

  /**
   * Initialise le gestionnaire et charge les données du compte
   */
  async init() {
    try {
      await this.loadAccountData();
      this.setupEventListeners();
      this.startAutoRefresh(); // Démarrer la mise à jour automatique
      console.log('✅ Gestionnaire de compte initialisé');
      return true;
    } catch (err) {
      console.error('❌ Erreur initialisation:', err);
      return false;
    }
  }

  /**
   * Charge les données du compte depuis l'API
   */
  async loadAccountData() {
    try {
      this.isLoading = true;
      
      // Charger le compte
      const accountRes = await fetch('/api/v1/accounts/me', {
        method: 'GET',
        credentials: 'include'
      });

      if (!accountRes.ok) {
        if (accountRes.status === 401) {
          console.error('Session expirée');
          return null;
        }
        throw new Error(`Erreur ${accountRes.status}`);
      }

      const accountData = await accountRes.json();
      this.currentAccount = accountData.account;
      
      // Mettre à jour le solde NET
      this.currentBalance = parseFloat(accountData.account.currentBalance) || 0;
      this.accountStatus = accountData.account.status;
      
      console.log(`✅ Compte chargé: Solde NET = ${this.currentBalance.toFixed(2)} HTG (${this.accountStatus})`);

      // Mettre à jour le DOM
      this.updateBalanceDisplay();
      
      // Notifier les listeners
      this.notifyListeners();

      // Charger les transactions
      await this.loadTransactions();

      return this.currentAccount;
    } catch (err) {
      console.error('Erreur lors du chargement du compte:', err);
      return null;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Configure les écouteurs d'événements
   */
  setupEventListeners() {
    // Bouton refresh dans le header
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.manualRefresh());
    }

    // Écouter les événements du serveur via WebSocket
    this.setupWebSocketListeners();
  }

  /**
   * Configure les écouteurs WebSocket pour les mises à jour en temps réel
   */
  setupWebSocketListeners() {
    // Si un WebSocket existe, on l'écoute pour les transactions
    // Cela permettra une mise à jour instantanée du solde quand un payout est effectué
    
    // Pour le WebSocket cashier
    if (window.cashierWS) {
      this.setupCashierWebSocketListener();
    }

    // Écouter le WebSocket global s'il existe
    if (window.ws) {
      this.setupGlobalWebSocketListener();
    }

    console.log('📡 Écouteurs WebSocket configurés');
  }

  /**
   * Configure l'écouteur pour le WebSocket du caissier
   */
  setupCashierWebSocketListener() {
    const originalHandler = window.handleCashierWebSocketMessage;
    
    window.handleCashierWebSocketMessage = (data) => {
      // Appeler le handler original s'il existe
      if (originalHandler && typeof originalHandler === 'function') {
        originalHandler(data);
      }

      // Mettre à jour le solde si c'est une transaction
      if (data.event === 'payout' || data.event === 'payment' || data.event === 'transaction') {
        console.log('💳 Transaction détectée via WebSocket, rechargement du solde...');
        this.loadAccountData().catch(err => {
          console.warn('⚠️ Erreur lors du rechargement après transaction:', err.message);
        });
      }
    };
  }

  /**
   * Configure l'écouteur pour le WebSocket global
   */
  setupGlobalWebSocketListener() {
    // À implémenter selon le pattern du WebSocket global
  }

  /**
   * Recharge manuellement les données (quand utilisateur clique refresh)
   */
  async manualRefresh() {
    const btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Actualisation...';
    }

    try {
      await this.loadAccountData();
      console.log('✅ Rechargement manuel du solde');
      if (btn) {
        btn.textContent = '✓ Actualisé';
        setTimeout(() => {
          btn.textContent = 'Refresh';
          btn.disabled = false;
        }, 1500);
      }
    } catch (err) {
      console.error('❌ Erreur rechargement:', err);
      if (btn) {
        btn.textContent = 'Erreur!';
        setTimeout(() => {
          btn.textContent = 'Refresh';
          btn.disabled = false;
        }, 2000);
      }
    }
  }

  /**
   * Met à jour l'affichage du solde dans le DOM
   * C'est la fonction clé pour afficher le montant NET actuel du serveur
   */
  updateBalanceDisplay() {
    const balanceElement = document.getElementById('cashBalanceHeader');
    if (!balanceElement) {
      console.warn('⚠️ Element #cashBalanceHeader not found');
      return;
    }

    // Formater le solde NET avec séparateurs de milliers (récupéré du serveur)
    const formattedBalance = this.currentBalance.toLocaleString('fr-HT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    // Mettre à jour le texte du solde NET
    balanceElement.textContent = `${formattedBalance} HTG`;

    // Appliquer une couleur selon le statut et le montant
    if (this.accountStatus === 'closed') {
      // Compte fermé = gris
      balanceElement.className = 'font-semibold text-slate-400';
      balanceElement.title = `Caisse fermée - Solde NET: ${formattedBalance} HTG`;
    } else if (this.currentBalance < 0) {
      // Solde négatif = ROUGE (alerte!)
      balanceElement.className = 'font-semibold text-red-500 animate-pulse';
      balanceElement.title = `⚠️ Solde NET NÉGATIF: ${formattedBalance} HTG`;
    } else if (this.currentBalance === 0) {
      // Solde zéro = ORANGE
      balanceElement.className = 'font-semibold text-amber-400';
      balanceElement.title = `Solde NET zéro: ${formattedBalance} HTG`;
    } else {
      // Solde positif = VERT
      balanceElement.className = 'font-semibold text-green-500';
      balanceElement.title = `Solde NET: ${formattedBalance} HTG (Caisse ${this.accountStatus})`;
    }

    console.log(`💰 Affichage mis à jour - Solde NET du serveur: ${formattedBalance} HTG (${this.accountStatus})`);
  }

  /**
   * Démarre le rechargement automatique du solde (toutes les 15 secondes)
   */
  startAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }

    // Recharger immédiatement au démarrage
    this.loadAccountData().catch(err => {
      console.warn('⚠️ Erreur rechargement initial:', err.message);
    });

    // Puis recharger toutes les 15 secondes
    this.autoRefreshInterval = setInterval(() => {
      this.loadAccountData().catch(err => {
        console.warn('⚠️ Erreur rechargement auto:', err.message);
      });
    }, 15000); // 15 secondes

    console.log('📊 Auto-refresh activé (15s)');
  }

  /**
   * Arrête le rechargement automatique
   */
  stopAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
      console.log('⏹️ Auto-refresh arrêté');
    }
  }

  /**
   * Enregistre un listener pour les changements de solde
   */
  onChange(callback) {
    this.updateListeners.push(callback);
  }

  /**
   * Notifie tous les listeners des changements
   */
  notifyListeners() {
    this.updateListeners.forEach(callback => {
      try {
        callback({
          balance: this.currentBalance,
          status: this.accountStatus,
          account: this.currentAccount
        });
      } catch (err) {
        console.error('❌ Erreur callback listener:', err);
      }
    });
  }

  /**
   * Charge le solde actuel
   */
  async getBalance() {
    try {
      const res = await fetch('/api/v1/accounts/me/balance', {
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      
      const data = await res.json();
      return data.balance;
    } catch (err) {
      console.error('Erreur lors de la récupération du solde:', err);
      return 0;
    }
  }

  /**
   * Charge l'historique des transactions
   */
  async loadTransactions(limit = 20) {
    try {
      const res = await fetch(`/api/v1/accounts/me/transactions?limit=${limit}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!res.ok) throw new Error(`Erreur ${res.status}`);

      const data = await res.json();
      this.transactions = data.transactions || [];
      console.log('✅ Transactions chargées:', this.transactions.length);
      
      return this.transactions;
    } catch (err) {
      console.error('Erreur lors du chargement des transactions:', err);
      return [];
    }
  }
  async openAccount(openingBalance) {
    try {
      const res = await fetch('/api/v1/accounts/me/open', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingBalance })
      });

      if (!res.ok) throw new Error(`Erreur ${res.status}`);

      const data = await res.json();
      this.currentAccount = data.account;
      console.log('✅ Compte ouvert');
      
      // Recharger les données
      await this.loadAccountData();
      
      return data;
    } catch (err) {
      console.error('Erreur lors de l\'ouverture du compte:', err);
      throw err;
    }
  }

  /**
   * Ferme le compte du caissier
   */
  async closeAccount(notes = '') {
    try {
      const res = await fetch('/api/v1/accounts/me/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closingNotes: notes })
      });

      if (!res.ok) throw new Error(`Erreur ${res.status}`);

      const data = await res.json();
      this.currentAccount = data.account;
      console.log('✅ Compte fermé');
      
      return data;
    } catch (err) {
      console.error('Erreur lors de la fermeture du compte:', err);
      throw err;
    }
  }

  /**
   * Ajoute une transaction au compte
   */
  async addTransaction(type, amount, reference = null, description = '') {
    try {
      const res = await fetch('/api/v1/accounts/me/transaction', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, amount, reference, description })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Erreur ${res.status}`);
      }

      const data = await res.json();
      console.log('✅ Transaction ajoutée:', data.transaction);
      
      // Recharger les données
      await this.loadAccountData();
      
      return data.transaction;
    } catch (err) {
      console.error('Erreur lors de l\'ajout de transaction:', err);
      throw err;
    }
  }

  /**
   * Récupère les statistiques du compte
   */
  async getStats() {
    try {
      const res = await fetch('/api/v1/accounts/me/stats', {
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      
      const data = await res.json();
      return data.stats;
    } catch (err) {
      console.error('Erreur lors de la récupération des stats:', err);
      return null;
    }
  }

  /**
   * Récupère un relevé de compte pour une période
   */
  async getStatement(fromDate, toDate) {
    try {
      const res = await fetch('/api/v1/accounts/me/statement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDate, toDate })
      });

      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      
      const data = await res.json();
      return data.statement;
    } catch (err) {
      console.error('Erreur lors de la récupération du relevé:', err);
      return [];
    }
  }

  /**
   * Configure les écouteurs d'événements
   */
  setupEventListeners() {
    // À implémenter selon les besoins UI spécifiques
  }

  /**
   * Crée un élément HTML pour afficher le compte
   */
  createAccountWidget() {
    const account = this.currentAccount;
    if (!account) {
      return `<div class="alert alert-warning">Compte non chargé</div>`;
    }

    const statusBadge = account.status === 'open'
      ? '<span class="badge badge-success">OUVERT</span>'
      : '<span class="badge badge-secondary">FERMÉ</span>';

    const openingTimeFormatted = account.openingTime
      ? new Date(account.openingTime).toLocaleString('fr-FR')
      : 'Non ouvert';

    return `
      <div class="account-widget card">
        <div class="card-header">
          <h5>Mon Compte de Caisse</h5>
          ${statusBadge}
        </div>
        <div class="card-body">
          <div class="row">
            <div class="col-md-6">
              <div class="stat-item">
                <label>Solde Actuel</label>
                <div class="balance">${account.currentBalance.toFixed(2)} HTG</div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="stat-item">
                <label>Solde d'Ouverture</label>
                <div>${account.openingBalance.toFixed(2)} HTG</div>
              </div>
            </div>
          </div>
          <div class="row mt-3">
            <div class="col-md-6">
              <div class="stat-item">
                <label>Ouverture</label>
                <div class="small text-muted">${openingTimeFormatted}</div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="stat-item">
                <label>Statut</label>
                <div>${account.status.toUpperCase()}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="card-footer">
          ${this.createActionButtons()}
        </div>
      </div>
    `;
  }

  /**
   * Crée les boutons d'action
   */
  createActionButtons() {
    const account = this.currentAccount;
    if (!account) return '';

    let buttons = '';

    if (account.status === 'closed') {
      buttons += `
        <button class="btn btn-sm btn-primary" onclick="accountManager.showOpenDialog()">
          📂 Ouvrir la caisse
        </button>
      `;
    } else {
      buttons += `
        <button class="btn btn-sm btn-success" onclick="accountManager.showDepositDialog()">
          💰 Dépôt
        </button>
        <button class="btn btn-sm btn-warning" onclick="accountManager.showWithdrawalDialog()">
          💸 Retrait
        </button>
        <button class="btn btn-sm btn-danger" onclick="accountManager.showCloseDialog()">
          🔒 Fermer la caisse
        </button>
      `;
    }

    buttons += `
      <button class="btn btn-sm btn-info" onclick="accountManager.showTransactionHistory()">
        📋 Historique
      </button>
    `;

    return buttons;
  }

  /**
   * Crée un élément pour afficher les transactions
   */
  createTransactionsTable() {
    if (!this.transactions || this.transactions.length === 0) {
      return `<div class="alert alert-info">Aucune transaction</div>`;
    }

    const rows = this.transactions.map(t => {
      const date = new Date(t.createdAt).toLocaleString('fr-FR');
      const typeLabel = this.getTransactionTypeLabel(t.type);
      const amountClass = ['deposit', 'cash-in', 'pay-receipt'].includes(t.type) ? 'text-success' : 'text-danger';
      const amountSign = ['deposit', 'cash-in', 'pay-receipt'].includes(t.type) ? '+' : '-';

      return `
        <tr>
          <td class="small">${date}</td>
          <td><span class="badge badge-info">${typeLabel}</span></td>
          <td class="${amountClass}"><strong>${amountSign}${t.amount.toFixed(2)}</strong></td>
          <td class="small">${t.description || t.reference || '-'}</td>
        </tr>
      `;
    }).join('');

    return `
      <table class="table table-sm table-striped">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Montant</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  /**
   * Retourne le libellé d'un type de transaction
   */
  getTransactionTypeLabel(type) {
    const labels = {
      'opening': 'Ouverture',
      'deposit': 'Dépôt',
      'withdrawal': 'Retrait',
      'cash-in': 'Entrée',
      'cash-out': 'Sortie',
      'payout': 'Décaissement',
      'pay-receipt': 'Paiement Reçu',
      'closing': 'Fermeture'
    };
    return labels[type] || type;
  }

  /**
   * Affiche un dialogue pour ouvrir la caisse
   */
  showOpenDialog() {
    const amount = prompt('Montant d\'ouverture (HTG):', '5000');
    if (amount !== null && amount !== '') {
      this.openAccount(parseFloat(amount))
        .then(() => alert('✅ Caisse ouverte'))
        .catch(err => alert('❌ Erreur: ' + err.message));
    }
  }

  /**
   * Affiche un dialogue pour dépôt
   */
  showDepositDialog() {
    const amount = prompt('Montant du dépôt (HTG):', '');
    if (amount !== null && amount !== '') {
      this.addTransaction('deposit', parseFloat(amount), null, 'Dépôt d\'argent')
        .then(() => alert('✅ Dépôt enregistré'))
        .catch(err => alert('❌ Erreur: ' + err.message));
    }
  }

  /**
   * Affiche un dialogue pour retrait
   */
  showWithdrawalDialog() {
    const amount = prompt('Montant du retrait (HTG):', '');
    if (amount !== null && amount !== '') {
      this.addTransaction('withdrawal', parseFloat(amount), null, 'Retrait d\'argent')
        .then(() => alert('✅ Retrait enregistré'))
        .catch(err => alert('❌ Erreur: ' + err.message));
    }
  }

  /**
   * Affiche un dialogue pour fermer la caisse
   */
  showCloseDialog() {
    const notes = prompt('Notes de fermeture:', 'Caisse équilibrée');
    if (notes !== null) {
      this.closeAccount(notes)
        .then(() => alert('✅ Caisse fermée'))
        .catch(err => alert('❌ Erreur: ' + err.message));
    }
  }

  /**
   * Affiche l'historique des transactions
   */
  showTransactionHistory() {
    alert('Affichage de l\'historique des transactions\n\nFonctionnalité à intégrer dans la page');
  }
}

// Export pour utilisation globale
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CashierAccountManager;
}
