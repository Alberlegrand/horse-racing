// --- Définition de l'export ---
// Exporter UNIQUEMENT la fonction 'launchTimer' demandée.
let initialDurationMs = 30000;
let remainingTimeMs = initialDurationMs;
let timerInterval = null;
let cycleCounter = 0;
let isRunning = false;
let startTime = 0;
let startRemaining = initialDurationMs;

function formatTime(ms) {
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((safeMs % 1000) / 10);
    const pad = (num, length = 2) => String(num).padStart(length, '0');
    return `${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function calculateRemainingTime() {
    if (isRunning) {
        const elapsedSinceStart = Date.now() - startTime;
        const currentRemaining = startRemaining - elapsedSinceStart;
        remainingTimeMs = Math.max(0, currentRemaining);
    }
}

function start(durationMs = initialDurationMs) {
    if (isRunning) return;
    if (timerInterval) clearInterval(timerInterval);

    startRemaining = durationMs;
    remainingTimeMs = durationMs;
    startTime = Date.now();

    if (remainingTimeMs <= 0) {
        console.error("Erreur : La durée doit être supérieure à zéro.");
        return;
    }

    timerInterval = setInterval(() => {
        calculateRemainingTime();
        if (remainingTimeMs <= 0) {
            timerFinished();
        }
    }, 10);
    isRunning = true;
}

function stop() {
    if (timerInterval) clearInterval(timerInterval);
    isRunning = false;
    calculateRemainingTime();
}

function reset() {
    stop();
    remainingTimeMs = initialDurationMs;
    cycleCounter = 0;
    process.stdout.write('\nMinuteur réinitialisé.\n');
}

function timerFinished() {
    stop();
    remainingTimeMs = 0;
    cycleCounter++;
    setTimeout(() => {
        start(initialDurationMs);
    }, 1000);
}

/**
 * launchTimer: Retourne le temps restant actuel du minuteur en millisecondes.
 * @returns {number} Temps restant en millisecondes (ou 0 si arrêté/terminé).
 */
export function launchTimer() {
    calculateRemainingTime();
    return remainingTimeMs;
}

// Logique de lancement automatique et d'exécution en console (déplacée pour les modules ES)
let isMain = false;
try {
  isMain = process.argv[1] === import.meta.url;
} catch (e) {
  // Ignorer l'erreur si import.meta.url n'est pas disponible
}

if (isMain) {
    cycleCounter = 1;
    start(initialDurationMs);
    
    function updateConsoleDisplay() {
        const currentTimeMs = launchTimer();
        const timeDisplay = formatTime(currentTimeMs);
        const output = `\r[Cycle ${cycleCounter}] Temps restant : ${timeDisplay}   `;
        process.stdout.write(output);
    }
    
    console.log(`Démarrage du minuteur en boucle avec la durée par défaut : ${formatTime(initialDurationMs)}`);
    
    const displayInterval = setInterval(updateConsoleDisplay, 100);

    process.on('SIGINT', () => {
        stop();
        clearInterval(displayInterval);
        process.stdout.write('\nMinuteur arrêté. Sortie.\n');
        process.exit(0);
    });
}
