#!/usr/bin/env node
/**
 * Test de la nouvelle architecture où profit-choice attribue les places 1-6
 * 
 * ARCHÉOLOGIE:
 * - createNewRound() crée les participants avec place:0 (pas d'attribution aléatoire)
 * - chooseProfitableWinner() détermine le gagnant ET attribue les places 1-6 à tous les participants
 * - calculateRaceResults() utilise directement allParticipantsWithPlaces du profit-choice
 */

import { BASE_PARTICIPANTS, chooseProfitableWinner, createNewRound, gameState } from './game.js';
import { chacha20Shuffle } from './chacha20.js';

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║  TEST: profit-choice attribue les places 1-6                  ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

// TEST 1: createNewRound() crée les participants SANS places
console.log('\n📋 TEST 1: createNewRound() - Participants créés sans places');
console.log('═══════════════════════════════════════════════════════════════\n');

// Créer un nouveau round (sans broadcast pour la test)
const roundId = await createNewRound({ checkLock: true, broadcast: null });
console.log(`✅ Round créé: ${roundId}\n`);

const round = gameState.currentRound;
console.log(`📊 Participants dans le round #${round.id}:`);

let allHavePlaceZero = true;
round.participants.forEach(p => {
    if (p.place !== 0) {
        allHavePlaceZero = false;
    }
    console.log(`   №${p.number} ${p.name} (coeff: ${p.coeff}, place: ${p.place})`);
});

if (allHavePlaceZero) {
    console.log('\n✅ TEST 1 PASSED: Tous les participants ont place:0 (pas d\'attribution aléatoire)');
} else {
    console.log('\n❌ TEST 1 FAILED: Certains participants ont des places != 0!');
    process.exit(1);
}

// TEST 2: chooseProfitableWinner() attribue les places 1-6
console.log('\n\n🎯 TEST 2: chooseProfitableWinner() - Attribution des places 1-6');
console.log('═══════════════════════════════════════════════════════════════\n');

// Créer des données de test avec des mises
const testRoundData = {
    participants: round.participants,
    receipts: [
        {
            id: 1,
            bets: [
                { number: 6, value: 1000, participant: { number: 6, name: 'De Bruyne', coeff: 5.5 } },
                { number: 7, value: 500, participant: { number: 7, name: 'Ronaldo', coeff: 4.7 } }
            ]
        },
        {
            id: 2,
            bets: [
                { number: 8, value: 2000, participant: { number: 8, name: 'Mbappe', coeff: 7.2 } },
                { number: 9, value: 800, participant: { number: 9, name: 'Halland', coeff: 5.8 } }
            ]
        }
    ]
};

const profitChoiceResult = chooseProfitableWinner(testRoundData, 0.25);

if (!profitChoiceResult.winner) {
    console.log('\n❌ TEST 2 FAILED: chooseProfitableWinner() n\'a pas retourné de gagnant!');
    process.exit(1);
}

const winner = profitChoiceResult.winner;
const allParticipantsWithPlaces = profitChoiceResult.allParticipantsWithPlaces;

console.log(`🏆 Gagnant sélectionné: №${winner.number} ${winner.name}`);
console.log(`\n📊 Tous les participants avec places attribuées:`);

// Vérifier que toutes les places 1-6 sont attribuées
const placesAssigned = new Set();
allParticipantsWithPlaces.forEach(p => {
    placesAssigned.add(p.place);
    const marker = p.place === 1 ? '🏆' : '  ';
    console.log(`${marker} Place ${p.place}: №${p.number} ${p.name}`);
});

const expectedPlaces = new Set([1, 2, 3, 4, 5, 6]);
let allPlacesCorrect = true;
let correctCount = 0;

for (let place of [1, 2, 3, 4, 5, 6]) {
    if (placesAssigned.has(place)) {
        correctCount++;
    } else {
        allPlacesCorrect = false;
    }
}

console.log(`\n🔍 Vérifications:`);
console.log(`   ✓ Places assignées: ${Array.from(placesAssigned).sort().join(', ')}`);
console.log(`   ✓ Nombre de places uniques: ${placesAssigned.size}/6`);
console.log(`   ✓ Gagnant (place 1): №${winner.number} === №${allParticipantsWithPlaces[0]?.number} ? ${Number(winner.number) === Number(allParticipantsWithPlaces.find(p => p.place === 1)?.number) ? '✅ OUI' : '❌ NON'}`);

if (allPlacesCorrect && placesAssigned.size === 6) {
    console.log('\n✅ TEST 2 PASSED: chooseProfitableWinner() a attribué tous les places 1-6 correctement');
} else {
    console.log(`\n❌ TEST 2 FAILED: Places incorrectes ou manquantes (${correctCount}/6)`);
    process.exit(1);
}

// TEST 3: Vérifier que le gagnant est bien en place 1 ET que c'est le seul
console.log('\n\n🏆 TEST 3: Validation du gagnant - place 1 unique');
console.log('═══════════════════════════════════════════════════════════════\n');

const winnersAtPlace1 = allParticipantsWithPlaces.filter(p => p.place === 1);

console.log(`📊 Participants en place 1:`);
winnersAtPlace1.forEach(p => {
    console.log(`   №${p.number} ${p.name}`);
});

if (winnersAtPlace1.length === 1 && Number(winnersAtPlace1[0].number) === Number(winner.number)) {
    console.log('\n✅ TEST 3 PASSED: Exactement 1 participant en place 1, et c\'est le gagnant sélectionné');
} else {
    console.log(`\n❌ TEST 3 FAILED: Erreur avec place 1 (${winnersAtPlace1.length} participant(s), attendu 1)`);
    process.exit(1);
}

// TEST 4: Vérifier que les autres participants ont des places différentes
console.log('\n\n🎲 TEST 4: Autres participants - places 2-6 uniques');
console.log('═══════════════════════════════════════════════════════════════\n');

const othersPlaces = allParticipantsWithPlaces.filter(p => p.place !== 1).map(p => p.place);
const uniqueOthersPlaces = new Set(othersPlaces);

console.log(`📊 Places des autres participants:`);
allParticipantsWithPlaces
    .filter(p => p.place !== 1)
    .sort((a, b) => a.place - b.place)
    .forEach(p => {
        console.log(`   Place ${p.place}: №${p.number} ${p.name}`);
    });

if (uniqueOthersPlaces.size === 5 && othersPlaces.every(p => p >= 2 && p <= 6)) {
    console.log('\n✅ TEST 4 PASSED: Tous les autres participants ont des places uniques 2-6');
} else {
    console.log(`\n❌ TEST 4 FAILED: Erreur avec les autres places (${uniqueOthersPlaces.size} uniques, attendu 5)`);
    process.exit(1);
}

// RÉSUMÉ FINAL
console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║  ✅ TOUS LES TESTS PASSÉS                                     ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

console.log('📊 ARCHÉOLOGIE FINALE:');
console.log('  1. createNewRound() → participants avec place:0');
console.log('  2. chooseProfitableWinner() → sélectionne gagnant + attribue places 1-6');
console.log('  3. calculateRaceResults() → utilise allParticipantsWithPlaces du profit-choice');
console.log('\n✅ profit-choice est l\'unique source de vérité pour les places!\n');

process.exit(0);
