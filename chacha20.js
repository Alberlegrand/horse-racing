/**
 * ChaCha20 CSPRNG - Cryptographically Secure Random Number Generator
 * Used for secure randomness in games (positions, shuffles)
 * Based on the ChaCha20 stream cipher algorithm
 * 
 * Fast, secure, and suitable for gaming applications
 */

class ChaCha20 {
    constructor(seed = null) {
        // Constants: ChaCha20 initial state
        this.constants = [
            0x61707865, // "expa"
            0x3320646e, // "nd 3"
            0x79622d32, // "2-by"
            0x6b206574  // "te k"
        ];

        // Initialize with seed or random seed
        if (!seed) {
            // Generate random seed from crypto API or fallback
            seed = this._generateRandomSeed();
        }

        this.key = this._expandSeed(seed);
        this.nonce = [0, 0, 0]; // 96-bit nonce (12 bytes)
        this.counter = 0;
        this.block = [];
        this.blockIndex = 16; // ✅ CRITIQUE: Initialiser à 16 pour forcer la génération du premier bloc
        console.log(`[CHACHA20] 🏗️ Constructeur: seed=${seed ? `fourni (${seed.length} mots)` : 'aléatoire'}, key=${this.key.length} mots`);
    }

    /**
     * Generate a random seed from the system
     */
    _generateRandomSeed() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            // Browser environment
            const arr = new Uint32Array(8);
            crypto.getRandomValues(arr);
            return Array.from(arr);
        } else if (typeof require !== 'undefined') {
            // Node.js environment
            try {
                const crypto = require('crypto');
                const buf = crypto.randomBytes(32);
                const arr = new Uint32Array(buf.buffer);
                return Array.from(arr);
            } catch {
                return this._fallbackSeed();
            }
        } else {
            return this._fallbackSeed();
        }
    }

    /**
     * Fallback seed generation (less ideal, but better than nothing)
     */
    _fallbackSeed() {
        const seed = [];
        for (let i = 0; i < 8; i++) {
            seed.push(Math.floor(Math.random() * 0x100000000));
        }
        return seed;
    }

    /**
     * Expand seed to 8 32-bit words (256-bit key)
     */
    _expandSeed(seed) {
        const key = new Uint32Array(8);
        for (let i = 0; i < Math.min(8, seed.length); i++) {
            key[i] = seed[i] >>> 0; // Ensure 32-bit unsigned
        }
        // Fill remaining with deterministic values derived from first bytes
        for (let i = seed.length; i < 8; i++) {
            key[i] = ((seed[i % seed.length] * 2654435761) >>> 0);
        }
        return key;
    }

    /**
     * ChaCha20 core algorithm - quarter round
     */
    _quarterRound(a, b, c, d, x) {
        x[a] = (x[a] + x[b]) >>> 0;
        x[d] = ((x[d] ^ x[a]) << 16 | (x[d] ^ x[a]) >>> 16) >>> 0;
        x[c] = (x[c] + x[d]) >>> 0;
        x[b] = ((x[b] ^ x[c]) << 12 | (x[b] ^ x[c]) >>> 20) >>> 0;
        x[a] = (x[a] + x[b]) >>> 0;
        x[d] = ((x[d] ^ x[a]) << 8 | (x[d] ^ x[a]) >>> 24) >>> 0;
        x[c] = (x[c] + x[d]) >>> 0;
        x[b] = ((x[b] ^ x[c]) << 7 | (x[b] ^ x[c]) >>> 25) >>> 0;
    }

    /**
     * Generate next 512 bits (64 bytes) of keystream
     */
    _generateBlock() {
        const x = new Uint32Array(16);
        
        // Initialize state
        for (let i = 0; i < 4; i++) {
            x[i] = this.constants[i];
        }
        for (let i = 0; i < 8; i++) {
            x[4 + i] = this.key[i];
        }
        x[12] = this.counter;
        x[13] = this.nonce[0];
        x[14] = this.nonce[1];
        x[15] = this.nonce[2];

        // Save initial state
        const working = new Uint32Array(x);

        // 20 rounds (10 double-rounds)
        for (let i = 0; i < 10; i++) {
            // Column round
            this._quarterRound(0, 4, 8, 12, x);
            this._quarterRound(1, 5, 9, 13, x);
            this._quarterRound(2, 6, 10, 14, x);
            this._quarterRound(3, 7, 11, 15, x);
            // Diagonal round
            this._quarterRound(0, 5, 10, 15, x);
            this._quarterRound(1, 6, 11, 12, x);
            this._quarterRound(2, 7, 8, 13, x);
            this._quarterRound(3, 4, 9, 14, x);
        }

        // Add initial state and convert to 32-bit array
        this.block = new Uint32Array(16);
        for (let i = 0; i < 16; i++) {
            this.block[i] = (x[i] + working[i]) >>> 0;
        }

        // ✅ LOG DE DIAGNOSTIC (temporaire pour debug)
        if (this.counter === 0 || this.counter === 1) {
            console.log(`[CHACHA20] 🔍 _generateBlock() counter=${this.counter}, block[0]=${this.block[0]} (0x${this.block[0].toString(16)}), block[1]=${this.block[1]} (0x${this.block[1].toString(16)})`);
            console.log(`[CHACHA20] 🔍 key[0]=${this.key[0]} (0x${this.key[0].toString(16)}), key[1]=${this.key[1]} (0x${this.key[1].toString(16)})`);
        }

        // Increment counter
        this.counter = (this.counter + 1) >>> 0;
        this.blockIndex = 0;
    }

    /**
     * Get next 32-bit random integer
     */
    next32() {
        if (this.blockIndex >= 16 || this.block.length === 0) {
            this._generateBlock();
        }
        
        // ✅ VÉRIFICATION: S'assurer que le bloc est valide
        if (!this.block || this.block.length === 0) {
            console.error(`[CHACHA20] ❌ ERREUR: Bloc vide après _generateBlock()!`);
            throw new Error('ChaCha20 block generation failed');
        }
        
        const value = this.block[this.blockIndex++];
        
        // ✅ LOG DE DIAGNOSTIC (temporaire pour debug)
        if (this.blockIndex <= 3) {
            console.log(`[CHACHA20] 🔍 next32() appel #${this.blockIndex}, valeur=${value} (0x${value.toString(16)})`);
        }
        
        return value;
    }

    /**
     * Get next random number in [0, 1) range (like Math.random())
     */
    random() {
        // Get two consecutive 32-bit values and combine for 53-bit precision
        const a = this.next32() >>> 5;  // 27 bits
        const b = this.next32() >>> 6;  // 26 bits
        return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
    }

    /**
     * Get next random integer in [0, max) range
     */
    nextInt(max) {
        if (max <= 0) throw new Error('max must be positive');
        if (max === 1) return 0;
        
        // Use rejection sampling for unbiased result
        const bits = Math.ceil(Math.log2(max));
        const mask = (1 << bits) - 1;
        let result;
        let attempts = 0;
        do {
            const rawValue = this.next32();
            result = rawValue & mask;
            attempts++;
            // ✅ SÉCURITÉ: Éviter les boucles infinies (max 100 tentatives)
            if (attempts > 100) {
                console.error(`[CHACHA20] ⚠️ nextInt(${max}) boucle infinie détectée! rawValue=${rawValue}, mask=${mask.toString(16)}, result=${result}`);
                // Fallback: utiliser modulo (moins idéal mais fonctionnel)
                result = rawValue % max;
                break;
            }
        } while (result >= max);
        
        // ✅ LOG DE DIAGNOSTIC (temporaire pour debug)
        if (attempts > 1) {
            console.log(`[CHACHA20] 🔍 nextInt(${max}) nécessité ${attempts} tentatives, résultat=${result}`);
        }
        
        return result;
    }

    /**
     * Set seed (reinitialize)
     */
    setSeed(seed) {
        this.key = this._expandSeed(seed);
        this.nonce = [0, 0, 0];
        this.counter = 0;
        this.blockIndex = 16; // ✅ CRITIQUE: Forcer la génération d'un nouveau bloc au prochain next32()
        this.block = []; // ✅ CRITIQUE: Vider le bloc pour forcer la régénération
        console.log(`[CHACHA20] 🔄 Seed réinitialisé, key=${this.key.length} mots, blockIndex=${this.blockIndex}`);
    }
}

/**
 * Global singleton instance for easy use
 */
let globalRng = null;

function getGlobalRng() {
    if (!globalRng) {
        globalRng = new ChaCha20();
    }
    return globalRng;
}

/**
 * Initialize ChaCha20 RNG with optional seed
 */
function initChaCha20(seed = null) {
    globalRng = new ChaCha20(seed);
    console.log(`[CHACHA20] ✅ RNG initialisé avec seed=${seed ? 'fourni' : 'aléatoire'}, key length=${globalRng.key.length}`);
    
    // ✅ TEST IMMÉDIAT: Générer quelques valeurs pour vérifier que ça fonctionne
    const test1 = globalRng.nextInt(100);
    const test2 = globalRng.nextInt(100);
    const test3 = globalRng.nextInt(6);
    console.log(`[CHACHA20] 🧪 Test immédiat après init: nextInt(100)=${test1}, nextInt(100)=${test2}, nextInt(6)=${test3}`);
    
    if (test1 === 0 && test2 === 0 && test3 === 0) {
        console.error(`[CHACHA20] ❌ ERREUR CRITIQUE: Tous les tests retournent 0! Le RNG ne fonctionne pas correctement.`);
    }
    
    return globalRng;
}

/**
 * Get random number in [0, 1) range
 */
function chacha20Random() {
    return getGlobalRng().random();
}

/**
 * Get random integer in [0, max) range
 */
function chacha20RandomInt(max) {
    return getGlobalRng().nextInt(max);
}

/**
 * Fisher-Yates shuffle using ChaCha20
 */
function chacha20Shuffle(array) {
    const rng = getGlobalRng();
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// Export ES6 modules
export {
    ChaCha20,
    getGlobalRng,
    initChaCha20,
    chacha20Random,
    chacha20RandomInt,
    chacha20Shuffle
};
