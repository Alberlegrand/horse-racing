/**
 * @param server {unknown}
 * @param context {unknown}
 * @constructor
 */
let GameManager = function (server, context) {
    this._server = server;
    this._context = context;
    /** @type {null | GameModel} */
    this._game = null;
};

/**
 * @param onGetRound {(data: import("./types").Game) => void}
 */
GameManager.prototype.getRoundRequest = function (onGetRound) {
    this._server.request("rounds", {
        action: "get"
    }, $.proxy(
        /** @param result {RoundsGetResponse} */
        function (result) {
            this._game = this._decodeGame(result);
            onGetRound(this._game);
        }, this)
    );
};

/**
 * @param onStartRound {() => void}
 */
GameManager.prototype.startRoundRequest = function (onStartRound) {
    let gameId = this._game.id;
    this._server.request("rounds", {
        action: "finish",
        game_id: gameId,
    }, $.proxy(
        /** @param result {import("./types").RoundsFinishResponse} */
        function (result) {
            this.confirmRoundResultRequest(gameId, $.proxy(
            function (confirmResult) {
                if (confirmResult && parseInt(confirmResult.id) === gameId) {
                    this._game = this._decodeGame(result);
                    onStartRound();
                }
            }, this));
        }, this)
    );
};

/**
 * @param id {unknown}
 * @param onConfirmRound {(data: import("./types").RoundsConfirmResponse) => void}
 */
GameManager.prototype.confirmRoundResultRequest = function (id, onConfirmRound) {
    let gameId = this._game.id;
    this._server.request("rounds", {
        action: "confirm",
        game_id: gameId,
    }, $.proxy(
        /** @param result {import("./types").RoundsConfirmResponse} */
        function (result) {
            onConfirmRound(result);
        }, this)
    );
};

/**
 * @param onGetMoney {(data: import("./types").MoneyResponse) => void}
 */
GameManager.prototype.getMoneyRequest = function (onGetMoney) {
    this._server.request(
        "money/",
        {},
        $.proxy(
            /** @param result {import("./types").MoneyResponse} */
            function (result) {
                onGetMoney(result.money);
            }, this)
    );
};

/**
 * @param receipt {import('./types').ReceiptsAddPayload}
 * @param onCreateReceipt {(data: import("./types").ReceiptsAddResponse) => void}
 */
GameManager.prototype.createReceiptRequest = function (receipt, onCreateReceipt) {
    this._server.request(
        "receipts/?action=add",
        receipt,
        $.proxy(
            /** @param result {import("./types").ReceiptsAddResponse} */
            function (result) {
                onCreateReceipt(result);
            },
            this
        )
    );
};

/**
 * @param id {number}
 * @param onDeleteReceipt {(data: import('./types').ReceiptsDeleteResponse) => void}
 */
GameManager.prototype.deleteReceiptRequest = function (id, onDeleteReceipt) {
    this._server.request(
        "receipts/?action=delete",
        {
            action: "delete",
            id: id
        },
        $.proxy(
            /** @param result {import('./types').ReceiptsDeleteResponse} */
            function (result) {
                onDeleteReceipt(result);
            },
            this
        )
    );
};

/**
 * @param response {import("./types").RoundsGetResponse}
 * @returns {GameModel}
 */
GameManager.prototype._decodeGame = function (response) {
    // Accept wrapped responses { data: ... } and guard against missing fields
    if (response && response.data) response = response.data;
    response = response || {};

    const participantsArr = Array.isArray(response.participants) ? response.participants : [];
    let participants = participantsArr.sort(function (a, b) {
        return a.number > b.number ? 1 : -1;
    }).map($.proxy(this._decodeParticipant, this));

    const receiptsArr = Array.isArray(response.receipts) ? response.receipts : [];
    let receipts = receiptsArr.length ? receiptsArr.map($.proxy(this._decodeReceipt, this)) : null;

    return new GameModel(response.id, participants, receipts);
};

/**
 * @param response {{number: number; name: string; coeff: string;}}
 * @param index {number}
 * @returns {Participant}
 */
GameManager.prototype._decodeParticipant = function (response, index) {
    return new GameModel.ParticipantModel(response.number, index, response.name, new Big(response.coeff), response.place);
};

/**
 * @param response {{id: string; number: string; prize: string; bets: {number: number; value: string;}[]}}
 * @returns {Receipt}
 */
GameManager.prototype._decodeReceipt = function (response) {
    let bets = response.bets.map($.proxy(this._decodeBet, this));
    /** FIXME: incorrect first argument value type (has not transform into Model type) */
    return new GameModel.ReceiptModel(response.id, bets, new Big(response.prize));
};

/**
 * @param response {{number: number; value: string;}}
 * @returns {Bet}
 */
GameManager.prototype._decodeBet = function (response) {
    return new GameModel.BetModel(response.number, new Big(response.value));
};

GameManager.prototype.getGame = function () {
    return this._game;
};

/**
 * ✅ MET À JOUR LE GAME DEPUIS LE WEBSOCKET (race_start event)
 * @param gameData {import("./types").Game}
 */
GameManager.prototype.updateGameFromWebSocket = function (gameData) {
    console.log('[GameManager] Mise à jour du game depuis WebSocket:', gameData);
    if (gameData) {
        this._game = this._decodeGame(gameData);
        console.log('[GameManager] ✅ Game mis à jour avec les données du WebSocket');
    }
};
