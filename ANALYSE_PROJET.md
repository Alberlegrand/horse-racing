# 📊 Analyse Complète du Projet Horse Racing

## 🎯 Vue d'Ensemble
Application de pari sur courses de chevaux (Paryaj Cheval) développée avec Node.js/Express côté serveur et JavaScript côté client.

---

## 📁 Structure du Projet

### Fichiers Principaux

#### **Backend (Serveur)**
1. **`server.js`** (118 lignes)
   - Point d'entrée principal du serveur
   - Configure Express, middleware CORS, fichiers statiques
   - Lance serveur HTTP (port 8080) et WebSocket (port 8081)
   - Routes pour HTML statiques et API v1
   - Utilise des routeurs modulaires depuis `routes/`

2. **`index.js`** (470 lignes)
   - ⚠️ **FICHIER ANCIEN/DUPLIQUÉ** : Contient une ancienne implémentation monolithique
   - Gère l'état du jeu, routes API, WebSocket
   - **Problème** : Duplication de logique avec `server.js` et `game.js`
   - **Recommandation** : Ce fichier semble obsolète, devrait être supprimé ou refactorisé

3. **`game.js`** (82 lignes)
   - ✅ **MÉTADONNÉES DU JEU CENTRALISÉES**
   - Exporte `gameState` (état partagé)
   - Fonctions : `startNewRound()`, `wrap()`
   - Définit `BASE_PARTICIPANTS` (6 chevaux : De Bruyne, Ronaldo, Mbappe, Halland, Messi, Vinicius)
   - Gère l'historique des tours (max 10)

4. **`utils.js`** (13 lignes)
   - Fonction utilitaire `escapeHtml()` pour sécuriser les sorties HTML

5. **`timer.js`** (112 lignes)
   - Module de minuteur autonome
   - Exporte `launchTimer()` pour obtenir le temps restant
   - Peut fonctionner en mode console indépendant
   - ⚠️ **Non utilisé actuellement dans l'app**

#### **Routes API (`routes/`)**

1. **`rounds.js`** (160 lignes)
   - Gère les tours de jeu
   - **GET `/api/v1/rounds/launch-time`** : Retourne le temps restant avant le prochain tour
   - **POST `/api/v1/rounds/`** avec actions :
     - `action: "get"` : Récupère le tour actuel
     - `action: "finish"` : Démarre la course (simulation 7s), puis attendre 10s avant nouveau tour
     - `action: "confirm"` : Confirme le tour
   - Logique de minuteur avec `gameState.nextRoundStartTime`

2. **`receipts.js`** (159 lignes)
   - Gère les tickets de pari
   - **GET `/api/v1/receipts/?action=print&id=XXX`** : Génère HTML d'impression de ticket
   - **POST `/api/v1/receipts/?action=add`** : Ajoute un nouveau ticket
   - **POST `/api/v1/receipts/?action=delete&id=XXX`** : Supprime un ticket
   - Calcule les gains basés sur le gagnant

3. **`my_bets.js`** (151 lignes)
   - Gère l'historique des paris
   - **GET `/api/v1/my-bets/`** avec filtres :
     - `page`, `limit` : Pagination
     - `date`, `status`, `searchId` : Filtres
   - Retourne tickets en cours + historique avec statistiques

4. **`keepalive.js`** (35 lignes)
   - ⚠️ **INCOMPLET** : Références `PORT` et `wrap()` non définis
   - Devrait maintenir la session utilisateur

5. **`money.js`** (13 lignes)
   - **POST `/api/v1/money/`** : Retourne solde fictif (5000 HTG)

#### **Frontend (HTML)**

1. **`index.html`** (232 lignes)
   - Page principale de jeu (course de chevaux)
   - Structure : participants, contrôles, écrans (game/movie/finish)
   - Scripts WebSocket pour événements temps réel
   - Chargement de multiples scripts JS depuis `/js/`

2. **`horse.html`** (233 lignes)
   - ⚠️ **DUPLIQUÉ** : Identique à `index.html`
   - Même structure et scripts

3. **`cashier.html`** (168 lignes)
   - Interface caissier simplifiée
   - Pas de bouton "Start" (contrairement à `index.html`)
   - Même structure de jeu mais pour gestion caissier

4. **`bet_frame.html`** (170 lignes - non lu, probablement similaire)

5. **`test.html`** (368 lignes)
   - Page de test avec configuration WebSocket locale
   - Participants hardcodés pour tests

6. **`test copy.html`** (124 lignes)
   - Iframe intégrant jeu depuis `phorses.paryajpam.com`
   - Template pour intégration externe

---

## 🔧 Technologies Utilisées

### Backend
- **Node.js** (ES Modules)
- **Express 5.1.0** : Framework web
- **ws 8.18.3** : WebSocket server
- **pg 8.16.3** : Client PostgreSQL (⚠️ non utilisé actuellement)
- **cors, body-parser, helmet, express-rate-limit** : Sécurité et middleware

### Frontend
- **jQuery** : Manipulation DOM
- **Crafty.js 0.5.4** : Moteur de jeu 2D (pour animation course)
- **Big.js** : Calculs de précision (monnaie)
- **Centrifuge** : Client WebSocket pour temps réel
- **CSS personnalisé** : Styles dans `/static/css/`

### Structure des Données

#### Participants (6 chevaux)
```javascript
BASE_PARTICIPANTS = [
  { number: 6, name: "De Bruyne", coeff: 5.5, family: 0 },
  { number: 7, name: "Ronaldo", coeff: 4.7, family: 1 },
  { number: 8, name: "Mbappe", coeff: 7.2, family: 2 },
  { number: 9, name: "Halland", coeff: 5.8, family: 3 },
  { number: 10, name: "Messi", coeff: 8.1, family: 4 },
  { number: 54, name: "Vinicius", coeff: 4.5, family: 5 }
]
```

#### Structure d'un Tour (`currentRound`)
```javascript
{
  id: 96908000-96908999 (aléatoire),
  participants: [...], // avec place assignée (1-6)
  receipts: [...], // tickets de pari
  lastReceiptId: 3,
  totalPrize: 0
}
```

#### Structure d'un Ticket (`receipt`)
```javascript
{
  id: Math.floor(Math.random() * 10000000000),
  bets: [
    {
      participant: {...},
      number: participant.number,
      value: montantMise,
      prize: 0
    }
  ],
  prize: totalGain,
  created_time: ISO string
}
```

---

## 🔄 Flux de l'Application

### Cycle de Vie d'un Tour

1. **Nouveau Tour** (`startNewRound()`)
   - Génère ID aléatoire
   - Réinitialise `receipts` et `totalPrize`
   - Mélange les places des participants (Fisher-Yates)
   - Broadcast WebSocket `{ event: "new_round", game: {...} }`

2. **Période de Paris** (durée variable)
   - Clients peuvent ajouter des tickets via POST `/api/v1/receipts/?action=add`
   - Affichage des participants avec cotes

3. **Démarrage Course** (`action: "finish"`)
   - Broadcast `{ event: "race_start" }`
   - Simulation course : 7 secondes
   - Sélection aléatoire du gagnant
   - Calcul des gains pour chaque ticket

4. **Fin de Course**
   - Broadcast `{ event: "race_end", winner, receipts, prize }`
   - Attente 10 secondes (`ROUND_WAIT_DURATION_MS`)
   - Démarrage automatique nouveau tour

### WebSocket Events

| Event | Description |
|-------|-------------|
| `connected` | Client connecté, reçoit `roundId` |
| `new_round` | Nouveau tour créé avec données du jeu |
| `race_start` | Course démarrée |
| `race_end` | Course terminée, résultats envoyés |

---

## ⚠️ Problèmes Identifiés

### 🔴 Critiques

1. **`index.js` dupliqué/obsolète**
   - Contient logique monolithique incompatible avec architecture modulaire
   - Devrait être supprimé ou complètement refactorisé

2. **`keepalive.js` incomplet**
   - Références `PORT` et `wrap()` non définis
   - Devrait utiliser router Express, pas `express()` directement

3. **Pas de base de données**
   - Toutes les données en mémoire
   - Perte des données au redémarrage
   - `pg` installé mais non utilisé

4. **Sécurité**
   - Pas de validation des montants de paris
   - Pas d'authentification/autorisation
   - Injection possible dans HTML des tickets (partiellement mitigée par `escapeHtml()`)

### 🟡 Moyens

5. **`timer.js` non utilisé**
   - Module autonome jamais importé
   - Devrait être intégré ou supprimé

6. **Fichiers HTML dupliqués**
   - `index.html` et `horse.html` identiques
   - `test.html` et `test copy.html` pour tests uniquement

7. **Configuration WebSocket hardcodée**
   - URLs WebSocket dans plusieurs fichiers HTML
   - Devrait être centralisée

8. **Limites de paris non validées**
   - Min: 10 HTG, Max: 5000 HTG affichées mais non vérifiées côté serveur

---

## ✅ Points Positifs

1. **Architecture modulaire** : Routes séparées, `gameState` centralisé
2. **WebSocket temps réel** : Communication bidirectionnelle efficace
3. **Calculs de gains** : Logique correcte pour déterminer les gains
4. **Historique des tours** : Conservation des 10 derniers tours
5. **Format de réponse standardisé** : Fonction `wrap()` pour API

---

## 🎯 Recommandations

### Court Terme
1. ✅ Supprimer ou refactoriser `index.js` (obsolète)
2. ✅ Corriger `keepalive.js` (références manquantes)
3. ✅ Ajouter validation des montants de paris
4. ✅ Centraliser configuration WebSocket

### Moyen Terme
5. ✅ Intégrer base de données PostgreSQL (déjà dans dependencies)
6. ✅ Ajouter authentification/autorisation
7. ✅ Implémenter logging structuré
8. ✅ Tests unitaires pour logique de jeu

### Long Terme
9. ✅ Refactoriser code client (beaucoup de scripts JS chargés séquentiellement)
10. ✅ Ajouter monitoring/alertes
11. ✅ Documentation API complète (Swagger/OpenAPI)

---

## 📊 Statistiques du Projet

- **Fichiers JavaScript** : ~15 fichiers principaux
- **Lignes de code backend** : ~1000 lignes
- **Routes API** : 5 endpoints principaux
- **Pages HTML** : 6 pages
- **Participants** : 6 chevaux fixes
- **Durée course** : 7 secondes (simulation)
- **Attente entre tours** : 10 secondes

---

## 🔐 Notes de Sécurité

⚠️ **Production non prête** :
- Pas d'authentification
- Validation des entrées insuffisante
- Données sensibles (tickets) en mémoire uniquement
- Pas de rate limiting effectif
- CORS ouvert (`app.use(cors())`)

---

## 📝 Conclusion

Application fonctionnelle pour démonstration/tests avec architecture modulaire prometteuse. Nécessite améliorations de sécurité, persistance des données, et nettoyage de code dupliqué avant mise en production.

**État actuel** : 🟡 **Prototype Fonctionnel** (non prêt pour production)

---

*Analyse effectuée le : $(date)*

