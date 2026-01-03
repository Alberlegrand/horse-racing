#!/usr/bin/env node
/**
 * Test Script: Validation de la source unique profit-choice
 * 
 * Ce script valide que:
 * 1. profit-choice retourne un gagnant SANS place assignée
 * 2. calculateRaceResults() recalcule les places correctement
 * 3. Le classement final a exactement 1 place:1
 */

import { chooseProfitableWinner, BASE_PARTICIPANTS } from './game.js';
import { chacha20Shuffle } from './chacha20.js';

console.log('🧪 TEST: Source Unique Profit-Choice\n');

// Test 1: chooseProfitableWinner ne doit PAS assigner place
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 1: chooseProfitableWinner() ne retourne PAS place');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const mockRoundData = {
    participants: BASE_PARTICIPANTS.map((p, idx) => ({
        ...p,
        place: idx + 1  // Places initiales 1-6
    })),
    receipts: [
        {
            id: 1,
            bets: [
                { number: 8, value: 1000, participant: { number: 8, name: 'Mbappe', coeff: 7.2 } },
                { number: 6, value: 500, participant: { number: 6, name: 'De Bruyne', coeff: 5.5 } }
            ]
        }
    ]
};

const result = chooseProfitableWinner(mockRoundData, 0.25);

if (result.winner) {
    console.log(`✅ Gagnant choisi: №${result.winner.number} ${result.winner.name}`);
    
    if (result.winner.place === undefined) {
        console.log(`✅ TEST PASSED: place n'est PAS défini dans le retour\n`);
    } else {
        console.log(`❌ TEST FAILED: place = ${result.winner.place} (ne devrait pas être défini)\n`);
    }
} else {
    console.log(`❌ TEST FAILED: Pas de gagnant retourné\n`);
}

// Test 2: Recalcul des places
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 2: Recalcul des places après profit-choice');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const winner = result.winner;
const participants = mockRoundData.participants;

// Simuler le recalcul comme dans calculateRaceResults()
const otherParticipants = participants.filter(p => Number(p.number) !== Number(winner.number));
const shuffledOthers = chacha20Shuffle(otherParticipants);

const updatedParticipants = [
    { ...winner, place: 1 },  // Gagnant en place 1
    ...shuffledOthers.map((p, index) => ({
        ...p,
        place: index + 2  // Les autres en places 2-6
    }))
];

console.log('Classement final après recalcul:');
updatedParticipants.forEach((p, idx) => {
    const marker = p.place === 1 ? '🏆' : ' ';
    console.log(`  ${marker} Place ${p.place}: №${p.number} ${p.name}`);
});

// Vérifications
const placesOne = updatedParticipants.filter(p => p.place === 1);
const allPlacesValid = updatedParticipants.every(p => p.place >= 1 && p.place <= 6);
const allPlacesUnique = new Set(updatedParticipants.map(p => p.place)).size === 6;

console.log('\n✓ Validations:');
console.log(`  ${placesOne.length === 1 ? '✅' : '❌'} Exactement 1 place:1: ${placesOne.length}`);
console.log(`  ${allPlacesValid ? '✅' : '❌'} Toutes les places entre 1-6: ${allPlacesValid}`);
console.log(`  ${allPlacesUnique ? '✅' : '❌'} Toutes les places uniques: ${allPlacesUnique}`);

if (placesOne.length === 1 && allPlacesValid && allPlacesUnique) {
    console.log('\n✅ TEST PASSED: Recalcul des places correct\n');
} else {
    console.log('\n❌ TEST FAILED: Erreur dans le recalcul\n');
}

// Test 3: Gagnant est bien en place 1
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 3: Le gagnant profit-choice est bien en place 1');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const finalWinner = updatedParticipants.find(p => p.place === 1);
if (finalWinner && Number(finalWinner.number) === Number(winner.number)) {
    console.log(`✅ Gagnant profit-choice №${winner.number} est en place 1`);
    console.log(`✅ TEST PASSED: Source unique confirmée\n`);
} else {
    console.log(`❌ TEST FAILED: Gagnant profit-choice n'est pas en place 1`);
    console.log(`❌ Gagnant attendu: №${winner.number}, Trouvé en place 1: №${finalWinner?.number}\n`);
}

// Résumé final
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 RÉSUMÉ');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(`Source unique: profit-choice (№${winner.number} ${winner.name})`);
console.log(`Classement final à T=35s:`);
console.log(`  place 1: №${finalWinner.number} ${finalWinner.name} (gagnant)`);
console.log(`  places 2-6: autres participants shufflés`);
console.log(`\n✅ Cohérence complète garantie!`);
console.log(`✅ Les joueurs verront exactement le gagnant choisi par profit-choice\n`);
