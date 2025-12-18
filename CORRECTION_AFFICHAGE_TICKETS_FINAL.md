# ✅ CORRECTION FINALE - Affichage des Tickets dans Dashboard

**Date**: Correction appliquée  
**Statut**: ✅ PROBLÈME RÉSOLU

---

## 🔍 PROBLÈME IDENTIFIÉ

Le dashboard utilisait `/api/v1/my-bets/` qui filtre par `user_id`, mais le dashboard doit afficher **TOUS les tickets du round actuel**, pas seulement ceux de l'utilisateur connecté.

---

## ✅ SOLUTION APPLIQUÉE

**Fichier**: `static/js/app.js` ligne 445-490

**Changement**:
- **Avant**: Utilisait `/api/v1/my-bets/?limit=10&page=1` qui filtre par `user_id`
- **Après**: Utilise `/api/v1/init/dashboard` qui retourne `gameState.currentRound.receipts` directement

**Code corrigé**:
```javascript
const refreshTickets = async () => {
    try {
        // ✅ CORRECTION: Utiliser /api/v1/init/dashboard pour récupérer TOUS les tickets du round actuel
        // Cette route retourne gameState.currentRound.receipts directement, sans filtre user_id
        const res = await fetch('/api/v1/init/dashboard', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const dashboardData = data?.data || {};
        
        // Récupérer les tickets du round actuel (format brut depuis gameState)
        const rawTickets = dashboardData.tickets || [];
        const round = dashboardData.round || {};
        
        // ✅ CORRECTION: Formater les tickets pour correspondre au format attendu par updateTicketsTable
        const tickets = rawTickets.map(t => {
            // Calculer totalAmount depuis bets si pas présent
            let totalAmount = t.totalAmount;
            if (!totalAmount && Array.isArray(t.bets)) {
                totalAmount = t.bets.reduce((sum, b) => {
                    const valueSystem = Number(b.value || 0);
                    const valuePublic = Currency.systemToPublic(valueSystem);
                    return sum + valuePublic;
                }, 0);
            }
            
            return {
                id: t.id,
                roundId: round.id || t.roundId || '-',
                date: t.created_time || t.created_at || t.date,
                created_time: t.created_time,
                totalAmount: totalAmount || 0,
                bets: t.bets || [],
                status: t.status || 'pending',
                prize: t.prize || 0,
                isPaid: t.isPaid || false,
                paidAt: t.paid_at || null
            };
        });
        
        // Préparer le round avec les receipts pour updateStats
        const roundWithReceipts = {
            ...round,
            receipts: rawTickets
        };
        
        // Calculer les stats depuis les tickets
        const stats = {
            totalBetAmount: tickets.reduce((sum, t) => sum + (t.totalAmount || 0), 0),
            totalReceipts: tickets.length,
            activeTicketsCount: tickets.filter(t => t.status === 'pending').length,
            totalPrize: dashboardData.round?.totalPrize || 0
        };
        
        // Mettre à jour les stats avec les données du round
        updateStats(roundWithReceipts, stats);

        updateTicketsTable(tickets);
    } catch (err) {
        console.error('Erreur refreshTickets:', err);
        this.showToast('Erreur de connexion à l\'API.', 'error');
    }
};
```

---

## 🎯 RÉSULTAT

- ✅ Le dashboard affiche maintenant **TOUS les tickets** du round actuel
- ✅ Les tickets sont correctement formatés pour l'affichage
- ✅ Les stats sont calculées correctement depuis les tickets
- ✅ Le round actuel est mis à jour correctement

---

## 📝 NOTES

1. **Format des tickets**: Les tickets retournés par `/api/v1/init/dashboard` sont au format brut (depuis `gameState.currentRound.receipts`), donc ils doivent être formatés avant d'être passés à `updateTicketsTable`.

2. **totalAmount**: Si un ticket n'a pas de `totalAmount`, il est calculé depuis les `bets` en convertissant les valeurs système en valeurs publiques.

3. **roundId**: Le `roundId` est ajouté à chaque ticket depuis `round.id` pour l'affichage.

---

**Correction appliquée avec succès!** ✅

