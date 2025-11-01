// routes/rounds.js

import express from "express";
// On suppose que gameState est un objet partagé que nous pouvons modifier
import { gameState, startNewRound, wrap } from "../game.js";

// --- CONFIGURATION ---
// La valeur fixe que vous voulez pour l'intervalle d'attente.
// Nous utilisons directement cette valeur (30000 ms) et non un minuteur externe.
const ROUND_WAIT_DURATION_MS = 30000; // 30 secondes 

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
        const MOVIE_SCREEN_DURATION_MS = 23000; // 20 secondes pour movie_screen (correspond à la durée côté client)
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
            timerTotalDuration: ROUND_WAIT_DURATION_MS
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

        // === GET === (INCHANGÉ)
        if (action === "get") {
            return res.json(wrap(gameState.currentRound));
        }

        // === FINISH === (Logique de course et minuteur)
        if (action === "finish") {
            res.json(wrap({ success: true }));

            // Marque le début de la course pour la synchronisation
            gameState.isRaceRunning = true;
            gameState.raceStartTime = Date.now();
            gameState.raceEndTime = null;

            broadcast({ event: "race_start", roundId: gameState.currentRound.id });

            // IMPORTANT: La durée réelle du movie_screen côté client est ~20 secondes
            // On doit attendre 20 secondes avant d'envoyer race_end pour que movie_screen se termine
            const MOVIE_SCREEN_DURATION_MS = 20000; // 20 secondes pour movie_screen
            
            // Simule la durée de la course (20 secondes pour correspondre à movie_screen)
            setTimeout(() => {
                
                // --- VOTRE LOGIQUE DE JEU ORIGINALE (Règlement de la course) ---
                const participants = Array.isArray(gameState.currentRound.participants) ? gameState.currentRound.participants : [];
                if (participants.length === 0) {
                    console.error("finish: aucun participant -> annulation.");
                    return;
                }

                const winner = participants[Math.floor(Math.random() * participants.length)];
                
                const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

                gameState.currentRound.participants = participants.map(p =>
                    (p.number === winner.number ? winnerWithPlace : p)
                );

                let totalPrizeAll = 0;
                const receipts = Array.isArray(gameState.currentRound.receipts) ? gameState.currentRound.receipts : [];

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

                gameState.currentRound.totalPrize = totalPrizeAll;

                // Marque la fin de la course (fin du movie_screen, début du finish_screen)
                gameState.raceEndTime = Date.now();

                broadcast({
                    event: "race_end",
                    winner: winnerWithPlace,
                    receipts: JSON.parse(JSON.stringify(receipts)),
                    roundId: gameState.currentRound.id,
                    prize: gameState.currentRound.totalPrize,
                });
                
                // --- FIN DE VOTRE LOGIQUE DE JEU ORIGINALE ---
                
                // Marque la fin complète de la course après finish_screen
                setTimeout(() => {
                    gameState.isRaceRunning = false;
                    gameState.raceStartTime = null;
                    gameState.raceEndTime = null;
                }, 5000); // Après 5 secondes de finish_screen
                
                // IMPORTANT: On ne démarre PAS le timer ici !
                // Le timer sera démarré dans startNewRound() qui sera appelé APRÈS que le client
                // ait terminé movie_screen (~20s) + finish_screen (~5s) et cliqué sur "new_game".
                // Cela garantit que le timer de 30 secondes commence au bon moment.

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