// routes/rounds.js

import express from "express";
// On suppose que gameState est un objet partagé que nous pouvons modifier
import { gameState, startNewRound, wrap } from "../game.js";

// Import des fonctions et constantes nécessaires pour créer un nouveau round
const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1 },
    { number: 8, name: "Mbappe", coeff: 7.2, family: 2 },
    { number: 9, name: "Halland", coeff: 5.8, family: 3 },
    { number: 10, name: "Messi", coeff: 8.1, family: 4 },
    { number: 54, name: "Vinicius", coeff: 4.5, family: 5 }
];

function generateRoundId() {
    return Math.floor(96908000 + Math.random() * 1000);
}

// --- CONFIGURATION ---
// La valeur fixe que vous voulez pour l'intervalle d'attente.
// Nous utilisons directement cette valeur (120000 ms = 2 minutes) et non un minuteur externe.
const ROUND_WAIT_DURATION_MS = 180000; // 3 minutes (180000 ms) 

// --- INITIALISATION DE L'ÉTAT ---
// Stocke le timestamp exact du début du prochain round.
if (typeof gameState.nextRoundStartTime === 'undefined') {
    // null signifie qu'aucun minuteur d'attente n'est en cours (une course est active)
    gameState.nextRoundStartTime = null; 
}


/**
 * Crée le routeur pour les "rounds".
 * @param {function} broadcast - La fonction de diffusion WebSocket.
 * @returns {express.Router}
 */
export default function createRoundsRouter(broadcast) {
    const router = express.Router();

    // -----------------------------------------------------------------
    // --- API AJOUTÉE : GET /api/v1/rounds/launch-time ---
    // -----------------------------------------------------------------
    /**
     * Cet endpoint est la "Source de Vérité" pour le minuteur.
     * Il calcule le temps restant à partir du timestamp du futur lancement.
     */
    router.get("/launch-time", (req, res) => {
        let timeLeft = 0;
        const now = Date.now();

        // Vérifie si un timestamp de départ est défini et qu'il est dans le futur
        if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
            timeLeft = gameState.nextRoundStartTime - now;
        }

        console.log(`[API GET /launch-time] Temps restant : ${Math.round(timeLeft / 1000)}s`);

        res.json({
            // La seule valeur qui change est timeLeft
            timeLeft: Math.max(0, timeLeft), 
            // La durée totale d'attente est fixe
            delaiTotalAttente: ROUND_WAIT_DURATION_MS
        });
    });

    // -----------------------------------------------------------------
    // --- API AJOUTÉE : GET /api/v1/rounds/status ---
    // -----------------------------------------------------------------
    /**
     * Retourne l'état actuel du jeu pour la synchronisation au chargement de la page.
     * Permet de savoir quel écran afficher et le temps restant.
     */
    router.get("/status", (req, res) => {
        const now = Date.now();
        const MOVIE_SCREEN_DURATION_MS = 25000; // 25 secondes pour movie_screen (correspond à la durée côté client)
        const FINISH_DURATION_MS = 5000; // 5 secondes pour finish_screen
        const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_DURATION_MS; // 25 secondes total

        let screen = "game_screen"; // Par défaut
        let timeRemaining = 0;
        let timeInRace = 0; // Temps écoulé depuis le début de la course

        // Vérifie si une course est en cours
        if (gameState.isRaceRunning && gameState.raceStartTime) {
            timeInRace = now - gameState.raceStartTime;
            
            if (timeInRace < MOVIE_SCREEN_DURATION_MS) {
                // Course en cours (movie_screen)
                screen = "movie_screen";
                timeRemaining = MOVIE_SCREEN_DURATION_MS - timeInRace;
            } else if (timeInRace < TOTAL_RACE_TIME_MS) {
                // Course terminée, affichage du finish_screen
                screen = "finish_screen";
                timeRemaining = TOTAL_RACE_TIME_MS - timeInRace;
            } else {
                // Course terminée depuis plus de 25s, retour à game_screen
                screen = "game_screen";
                gameState.isRaceRunning = false;
                gameState.raceStartTime = null;
            }
        } else if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
            // Timer en cours avant la prochaine course
            timeRemaining = gameState.nextRoundStartTime - now;
            screen = "game_screen";
        }

        res.json({
            screen: screen,
            currentRound: gameState.currentRound,
            isRaceRunning: gameState.isRaceRunning,
            raceStartTime: gameState.raceStartTime,
            raceEndTime: gameState.raceEndTime,
            nextRoundStartTime: gameState.nextRoundStartTime,
            timeInRace: timeInRace,
            timeRemaining: Math.max(0, timeRemaining),
            timerTimeLeft: gameState.nextRoundStartTime && gameState.nextRoundStartTime > now 
                ? gameState.nextRoundStartTime - now 
                : 0,
            timerTotalDuration: ROUND_WAIT_DURATION_MS,
            gameHistory: gameState.gameHistory || []
        });
    });


    // -----------------------------------------------------------------
    // --- API EXISTANTE : POST /api/v1/rounds/ ---
    // -----------------------------------------------------------------
    router.post("/", (req, res) => {
        // Parsing défensif de l'action (INCHANGÉ)
        let rawBody = req.body;
        if (typeof rawBody === "string" && rawBody.trim()) {
            try { rawBody = JSON.parse(rawBody); } catch (e) { /* keep string */ }
        }
        const action =
            (rawBody && (rawBody.action || (rawBody.data && rawBody.data.action))) ||
            req.query.action ||
            null;

        // === GET === Retourne le round actuel avec toutes les infos de synchronisation
        if (action === "get") {
            const roundData = {
                ...gameState.currentRound,
                isRaceRunning: gameState.isRaceRunning,
                raceStartTime: gameState.raceStartTime,
                raceEndTime: gameState.raceEndTime,
                nextRoundStartTime: gameState.nextRoundStartTime
            };
            return res.json(wrap(roundData));
        }

        // === FINISH === (Logique de course et minuteur)
        if (action === "finish") {
            res.json(wrap({ success: true }));

            // Marque le début de la course pour la synchronisation
            const raceStartTime = Date.now();
            gameState.isRaceRunning = true;
            gameState.raceStartTime = raceStartTime;
            gameState.raceEndTime = null;

            // Broadcast complet avec toutes les informations de synchronisation
            broadcast({ 
                event: "race_start", 
                roundId: gameState.currentRound.id,
                raceStartTime: raceStartTime,
                currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
                isRaceRunning: true
            });

            // IMPORTANT: La durée réelle du movie_screen côté client est ~20 secondes
            // On doit attendre 20 secondes avant d'envoyer race_end pour que movie_screen se termine
            const MOVIE_SCREEN_DURATION_MS = 20000; // 20 secondes pour movie_screen
            const NEW_ROUND_PREPARE_DELAY_MS = 10000; // 10 secondes : créer le nouveau round pour permettre les paris
            
            // Créer le nouveau round après 10 secondes pour permettre aux caissiers de placer des paris
            // même si la course précédente continue
            setTimeout(() => {
                console.log('🆕 Préparation du nouveau round (10s après le début de la course)');
                
                // Sauvegarder l'ancien round pour la fin de course
                const oldRoundId = gameState.currentRound.id;
                gameState.runningRoundData = JSON.parse(JSON.stringify(gameState.currentRound));
                
                // Créer le nouveau round maintenant
                const newRoundId = generateRoundId();
                const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);
                
                // Mélange Fisher-Yates
                for (let i = basePlaces.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [basePlaces[i], basePlaces[j]] = [basePlaces[j], basePlaces[i]];
                }
                
                // Créer le nouveau round et le mettre dans currentRound (les nouveaux tickets iront dans ce round)
                const newRound = {
                    id: newRoundId,
                    participants: BASE_PARTICIPANTS.map((p, i) => ({
                        ...p,
                        place: basePlaces[i],
                    })),
                    receipts: [],
                    lastReceiptId: 3,
                    totalPrize: 0
                };
                
                // Remplacer currentRound par le nouveau round (les tickets iront maintenant dans le nouveau round)
                gameState.currentRound = newRound;
                
                // Démarre le timer de 2 minutes pour le prochain lancement
                const ROUND_WAIT_DURATION_MS = 120000; // 2 minutes
                const now = Date.now();
                gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
                
                // Broadcast le nouveau round pour que les caissiers puissent commencer à placer des paris
                broadcast({
                    event: "new_round",
                    roundId: newRoundId,
                    game: JSON.parse(JSON.stringify(newRound)),
                    currentRound: JSON.parse(JSON.stringify(newRound)),
                    timer: {
                        timeLeft: ROUND_WAIT_DURATION_MS,
                        totalDuration: ROUND_WAIT_DURATION_MS,
                        startTime: now,
                        endTime: gameState.nextRoundStartTime
                    },
                    nextRoundStartTime: gameState.nextRoundStartTime,
                    isRaceRunning: true, // La course précédente continue
                    raceStartTime: gameState.raceStartTime,
                    raceEndTime: null
                });
                
                console.log(`✅ Nouveau round #${newRoundId} activé et disponible pour les paris (course précédente #${oldRoundId} continue)`);
            }, NEW_ROUND_PREPARE_DELAY_MS);
            
            // Simule la durée de la course (20 secondes pour correspondre à movie_screen)
            setTimeout(() => {
                
                // --- VOTRE LOGIQUE DE JEU ORIGINALE (Règlement de la course) ---
                // Utiliser les données de l'ancien round sauvegardé
                const finishedRoundData = gameState.runningRoundData || gameState.currentRound;
                const participants = Array.isArray(finishedRoundData.participants) ? finishedRoundData.participants : [];
                if (participants.length === 0) {
                    console.error("finish: aucun participant -> annulation.");
                    return;
                }

                const winner = participants[Math.floor(Math.random() * participants.length)];
                
                const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

                // Mettre à jour les participants dans finishedRoundData
                finishedRoundData.participants = participants.map(p =>
                    (p.number === winner.number ? winnerWithPlace : p)
                );

                let totalPrizeAll = 0;
                const receipts = Array.isArray(finishedRoundData.receipts) ? finishedRoundData.receipts : [];

                receipts.forEach(receipt => {
                    let totalPrizeForReceipt = 0;
                    if (Array.isArray(receipt.bets)) {
                        receipt.bets.forEach(bet => {
                            if (Number(bet.number) === Number(winner.number)) {
                                const betValue = Number(bet.value) || 0;
                                const coeff = Number(winner.coeff) || 0;
                                totalPrizeForReceipt += betValue * coeff;
                            }
                        });
                    }
                    receipt.prize = totalPrizeForReceipt;
                    console.log(`Ticket #${receipt.id} gain : ${receipt.prize} HTG`);
                    totalPrizeAll += totalPrizeForReceipt;
                });

                // Utiliser les données de l'ancien round sauvegardé (avant qu'il soit remplacé par le nouveau round)
                finishedRoundData.totalPrize = totalPrizeAll;

                // Marque la fin de la course (fin du movie_screen, début du finish_screen)
                gameState.raceEndTime = Date.now();

                // Archiver l'ancien round
                const finishedRoundId = finishedRoundData.id;
                if (finishedRoundId) {
                    const finishedRound = {
                        id: finishedRoundId,
                        receipts: finishedRoundData.receipts || [],
                        participants: finishedRoundData.participants || [],
                        totalPrize: totalPrizeAll,
                        winner: winnerWithPlace,
                    };
                    gameState.gameHistory.push(finishedRound);
                    // Garde seulement les 10 derniers tours
                    if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
                }

                // Nettoyer la sauvegarde de l'ancien round
                gameState.runningRoundData = null;

                // Broadcast complet avec toutes les informations de fin de course (utilise l'ancien round ID)
                broadcast({
                    event: "race_end",
                    roundId: finishedRoundId, // Utilise l'ancien round ID pour la fin de course
                    winner: winnerWithPlace,
                    receipts: JSON.parse(JSON.stringify(receipts)),
                    prize: totalPrizeAll,
                    totalPrize: totalPrizeAll,
                    raceEndTime: gameState.raceEndTime,
                    currentRound: JSON.parse(JSON.stringify(finishedRoundData)), // Utilise les données de l'ancien round
                    participants: finishedRoundData.participants || []
                });
                
                // Le nouveau round est déjà dans currentRound et disponible pour les paris
                console.log(`✅ Course #${finishedRoundId} terminée, nouveau round #${gameState.currentRound.id} actif`);
                
                // --- FIN DE VOTRE LOGIQUE DE JEU ORIGINALE ---
                
                // Marque la fin complète de la course après finish_screen
                setTimeout(() => {
                    gameState.isRaceRunning = false;
                    gameState.raceStartTime = null;
                    gameState.raceEndTime = null;
                }, 5000); // Après 5 secondes de finish_screen

            }, MOVIE_SCREEN_DURATION_MS); // 20s pour correspondre à la durée réelle du movie_screen
                                          // + 5s de finish_screen = 25s total

            return;
        }

        // === CONFIRM === (INCHANGÉ)
        if (action === "confirm") {
            console.log("Confirmation du round", gameState.currentRound.id);
            return res.json(wrap(gameState.currentRound));
        }

        // === NEW_GAME === Nouvelle action pour démarrer un nouveau round après finish_screen
        if (action === "new_game") {
            console.log("🔄 Demande d'un nouveau round depuis le client");
            
            // Vérifie si un round est déjà en cours et qu'il n'y a pas de timer actif
            // Si un timer est actif, on ne fait rien (le timer gère déjà le nouveau round)
            if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > Date.now()) {
                console.log("⏰ Timer déjà en cours, le nouveau round sera créé automatiquement");
                return res.json(wrap({ 
                    success: true, 
                    message: "Timer already active",
                    timeLeft: gameState.nextRoundStartTime - Date.now()
                }));
            }
            
            // Crée un nouveau round et démarre le timer
            startNewRound(broadcast);
            return res.json(wrap({ success: true, round: gameState.currentRound }));
        }

        // Action inconnue (INCHANGÉ)
        return res.status(400).json({ error: "Unknown action" });
    });

    return router;
}