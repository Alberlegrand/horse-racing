/**
 * @param id {Game['id']}
 * @param participants {Game['participants']}
 * @param receipts {Game['receipts']}
 * @constructor
 */
let GameModel = function(id, participants, receipts) {
    this.id = id;
    this.participants = participants;
    this.receipts = receipts;
};

/**
 * @param number {Participant['number']}
 * @return {Participant | undefined}
 */
GameModel.prototype.getParticipantByNumber = function(number) {
    return this.participants.find(function(participant) {
        return participant.number === number;
    });
};

/**
 * @return {Participant | undefined}
 */
GameModel.prototype.getWinner = function() {
    return this.participants.find(function(participant) {
        return participant.place === 1;
    });
};

/**
 * @param number {Participant['number']}
 * @return {boolean}
 */
GameModel.prototype.hasBetsForParticipant = function(number) {
    return this.receipts ? this.receipts.some(function(receipt) {
        return receipt.getBetForParticipant(number) != null;
    }) : false;
};

/**
 * @return {Big}
 */
GameModel.prototype.getTotalPrize = function() {
    return this.receipts.reduce(function(accumulated, receipt) {
        return accumulated.plus(receipt.prize);
    }, new Big(0));
};

/**
 * @param number {Participant['number']}
 * @param family {Participant['family']}
 * @param name {Participant['name']}
 * @param coeff {Participant['coeff']}
 * @param place {Participant['place']}
 * @return {Participant}
 */
GameModel.ParticipantModel = function(number, family, name, coeff, place) {
    this.number = number;
    this.family = family;
    this.name = name;
    this.coeff = coeff;
    this.place = place;
};

/**
 * @param id {Receipt['id']}
 * @param bets {Receipt['bets']}
 * @param prize {Receipt['prize']}
 * @return {Receipt}
 * @constructor
 */
GameModel.ReceiptModel = function(id, bets, prize) {
    this.id = id;
    this.bets = bets;
    this.prize = prize;
};

/**
 * @return {Big}
 */
GameModel.ReceiptModel.prototype.getBetSum = function() {
    return this.bets.reduce(function(accumulated, bet) {
        return accumulated.plus(bet.value);
    }, new Big(0))
};

/**
 * @param number {Bet['number']}
 * @return {Bet | undefined}
 */
GameModel.ReceiptModel.prototype.getBetForParticipant = function(number) {
    return this.bets.find(function(bet) {
        return bet.number === number;
    });
};

/**
 * @param number {Bet['number']}
 * @param value {Bet['value']}
 * @return {Bet}
 */
GameModel.BetModel = function(number, value) {
    this.number = number;
    this.value = value;
};

/**
 * @param minBet {Limit['minBet']}
 * @param maxBet {Limit['maxBet']}
 * @constructor
 */
LimitModel = function(minBet, maxBet) {
    this.minBet = minBet;
    this.maxBet = maxBet;
};