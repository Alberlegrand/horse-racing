#!/usr/bin/env node

/**
 * Script de test de performance pour la création de tickets
 * Mesure la latence et le throughput
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8080';
const API_URL = 'http://localhost:8080/api/v1';

// Participants test
const PARTICIPANTS = [
  { number: 6, name: "De Bruyne", coeff: 5.5 },
  { number: 7, name: "Ronaldo", coeff: 4.7 },
  { number: 8, name: "Mbappe", coeff: 7.2 },
];

/**
 * Crée un ticket de test
 */
async function createTicket(participantNumber) {
  const ticket = {
    bets: [
      {
        participant: PARTICIPANTS.find(p => p.number === participantNumber),
        value: '1000'
      }
    ]
  };

  const response = await fetch(`${API_URL}/receipts?action=add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ticket)
  });

  if (!response.ok) {
    throw new Error(`Failed to create ticket: ${response.status}`);
  }

  return response.json();
}

/**
 * Test de latence unique
 */
async function testSingleTicket() {
  console.log('\n📊 TEST 1: Latence d\'un ticket unique');
  console.log('━'.repeat(50));

  const start = Date.now();
  const result = await createTicket(6);
  const latency = Date.now() - start;

  console.log(`✅ Ticket créé: ${result.data.id}`);
  console.log(`⏱️  Latence: ${latency}ms`);

  return latency;
}

/**
 * Test de throughput (N tickets séquentiels)
 */
async function testSequentialTickets(count = 10) {
  console.log(`\n📊 TEST 2: Throughput séquentiel (${count} tickets)`);
  console.log('━'.repeat(50));

  const latencies = [];
  const start = Date.now();

  for (let i = 0; i < count; i++) {
    const participantNum = PARTICIPANTS[i % PARTICIPANTS.length].number;
    const ticketStart = Date.now();
    
    try {
      await createTicket(participantNum);
      const ticketLatency = Date.now() - ticketStart;
      latencies.push(ticketLatency);
      process.stdout.write(`✓ ${i + 1}/${count} (${ticketLatency}ms)\r`);
    } catch (err) {
      console.error(`✗ Erreur ticket ${i + 1}: ${err.message}`);
    }
  }

  const totalTime = Date.now() - start;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);
  const throughput = (count / (totalTime / 1000)).toFixed(2);

  console.log(`\n✅ ${count} tickets créés en ${totalTime}ms`);
  console.log(`   Latence moyenne: ${avgLatency.toFixed(2)}ms`);
  console.log(`   Latence min: ${minLatency}ms`);
  console.log(`   Latence max: ${maxLatency}ms`);
  console.log(`   Throughput: ${throughput} tickets/sec`);

  return { totalTime, avgLatency, maxLatency, throughput };
}

/**
 * Test de concurrence (N tickets en parallèle)
 */
async function testConcurrentTickets(count = 10) {
  console.log(`\n📊 TEST 3: Concurrence (${count} tickets en parallèle)`);
  console.log('━'.repeat(50));

  const start = Date.now();
  const promises = [];

  for (let i = 0; i < count; i++) {
    const participantNum = PARTICIPANTS[i % PARTICIPANTS.length].number;
    promises.push(
      createTicket(participantNum)
        .catch(err => ({ error: err.message }))
    );
  }

  try {
    const results = await Promise.all(promises);
    const totalTime = Date.now() - start;
    
    const successes = results.filter(r => !r.error).length;
    const failures = results.filter(r => r.error).length;
    const throughput = (count / (totalTime / 1000)).toFixed(2);

    console.log(`✅ Complété en ${totalTime}ms`);
    console.log(`   Succès: ${successes}/${count}`);
    if (failures > 0) console.log(`   Échecs: ${failures}`);
    console.log(`   Throughput: ${throughput} tickets/sec`);

    return { totalTime, successes, failures, throughput };
  } catch (err) {
    console.error(`✗ Erreur: ${err.message}`);
  }
}

/**
 * Main
 */
async function main() {
  console.log('\n🎯 TEST DE PERFORMANCE: CRÉATION DE TICKETS');
  console.log('═'.repeat(50));
  console.log(`Serveur: ${BASE_URL}`);
  console.log(`API: ${API_URL}`);

  try {
    // Test 1: Latence unique
    const singleLatency = await testSingleTicket();

    // Test 2: Throughput séquentiel
    const seqResult = await testSequentialTickets(20);

    // Test 3: Concurrence
    const concResult = await testConcurrentTickets(20);

    // Résumé
    console.log('\n📈 RÉSUMÉ');
    console.log('═'.repeat(50));
    console.log(`Latence unique: ${singleLatency}ms`);
    console.log(`Throughput séquentiel: ${seqResult.throughput} tickets/sec`);
    console.log(`Throughput concurrence: ${concResult.throughput} tickets/sec`);
    console.log(`Amélioration concurrence: ${(concResult.throughput / seqResult.throughput).toFixed(2)}x`);
    
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Erreur: ${err.message}`);
    process.exit(1);
  }
}

main();
