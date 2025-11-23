/**
 * @param context {Context}
 * @param onInit {() => void}
 * @param onStartRound {() => void}
 * @constructor
 */
let GameScreen = function (context, onInit, onStartRound) {
    Screen.call(this, context, new GameScreenView(
        $.proxy(function (number, value) {  //onAddBet
            try {
                this._validateBet(number, value);
                this._addBet(number, value);
            } catch (e) {
                if (e instanceof GameScreen.ValidationError) {
                    this._context.getNotifier().showError(e.toString());
                } else {
                    throw e;
                }
            }
        }, this),
        $.proxy(this._removeBet, this), //onRemoveBet
        $.proxy(function () {   //onAddReceipt
            try {
                this._validateReceipt();
                this._addReceipt();
            } catch (e) {
                if (e instanceof GameScreen.ValidationError) {
                    this._context.getNotifier().showError(e.toString());
                } else {
                    throw e;
                }
            }
        }, this),
        $.proxy(this._removeReceipt, this), //onRemoveReceipt
        $.proxy(this._printReceipt, this),  //onPrintReceipt
        $.proxy(function () {   //onMakeReceipts
            try {
                this._validateReceipts();
                this._makeReceipts(onStartRound);
            } catch (e) {
                if (e instanceof GameScreen.ValidationError) {
                    this._context.getNotifier().showError(e.toString());
                } else {
                    throw e;
                }
            }
        }, this)
    ));
    this._receiptUrl = context.getSettings().receiptUrl;
    this._receipts = [];
    /** @type {(import('./types').Bet)[]} */
    this._bets = [];
    /** @type {() => void} */
    this._onInit = onInit;
};

/**
 * @param message {string}
 * @constructor
 */
GameScreen.ValidationError = function (message) {
    this._message = message;
};

/**
 * @returns {string}
 */
GameScreen.ValidationError.prototype.toString = function () {
    return this._message;
};

GameScreen.prototype.init = function () {
    this._view.init();
    this._context.getGameManager().getRoundRequest($.proxy(
        /** @param game {import('./types').Game} */
        function (game) {
            this._view.update(game);
            this._onInit();

            let receiptTable = this._view.getReceiptTable();
            let totalValue = this._getTotalValue();
            let receipts = this._receipts;
            if (game && game.receipts) {
                game.receipts.forEach(function (item) {
                    let receipt = new GameModel.ReceiptModel(item.id, item.bets, item.prize);
                    receipts.push(receipt);
                    receiptTable.addReceipt(receipt, totalValue);
                });
            }
            receiptTable._updateTotalValue(this._getTotalValue());
            this._view._updateReceiptCount();

        }, this)
    );
};

GameScreen.prototype.deinit = function () {
    this._view.deinit();
};

/**
 * @param number {number}
 * @param value {Big}
 */
GameScreen.prototype._validateBet = function (number, value) {
    let minBet = this._context.getSettings().limits.minBet;
    if (value.lt(minBet)) {
        throw new GameScreen.ValidationError(Messages.BET_TOO_SMALL.replace('$value', Currency.systemToPublic(minBet).toFixed(Currency.visibleDigits)));
    }
    let maxBet = this._context.getSettings().limits.maxBet;
    if (value.gt(maxBet)) {
        throw new GameScreen.ValidationError(Messages.BET_TOO_BIG.replace('$value', Currency.systemToPublic(maxBet).toFixed(Currency.visibleDigits)));
    }
};

/**
 * @param number {number}
 * @param value {Big}
 * @private
 */
GameScreen.prototype._addBet = function (number, value) {
    if (this._hasBetForParticipantAlready(number)) {
        return;
    }
    let rounded = value.round(null, 0);
    let bet = new GameModel.BetModel(number, rounded);
    this._bets.push(bet);
    let participant = this._context.getGameManager().getGame().getParticipantByNumber(number);
    let prize = rounded.times(participant.coeff).round(null, 0);
    this._view.setBet(number, rounded, prize);
};

/**
 * @param number {number}
 * @returns {boolean}
 */
GameScreen.prototype._hasBetForParticipantAlready = function (number) {
    return !!this._bets.find(function (bet) {
        return bet.number === number;
    });
};

/**
 * @param number {number}
 */
GameScreen.prototype._removeBet = function (number) {
    this._bets = this._bets.filter(function (bet) {
        return bet.number !== number;
    });
    this._view.setBet(number, null, null);
};

GameScreen.prototype._validateReceipt = function () {
    if (!this._bets.length) {
        throw new GameScreen.ValidationError(Messages.NO_BETS);
    }
};

GameScreen.prototype._addReceipt = function () {
    let receipt = new GameModel.ReceiptModel(-1, this._bets);

    let game = this._context.getGameManager().getGame();
    let newReceiptData = this._view._getNewReceiptData(game, receipt);

    this._context.getGameManager().createReceiptRequest(newReceiptData, $.proxy(
        /** @param result {import('./types').ReceiptsAddResponse} */
        function (result) {
            receipt.id = parseInt(result.id);
            if (receipt.id === -1) {
                throw new GameScreen.ValidationError(Messages.NO_BETS);
            }
            this._receipts.push(receipt);
            this._view.addReceipt(receipt, this._getTotalValue());
            this._bets.forEach($.proxy(function (bet) {
                this._view.setBet(bet.number, null, null);
            }, this));
            this._bets = [];
            
            // 🖨️ AUTO-PRINT TICKET AFTER CREATION
            console.log(`[GAME] 📋 Receipt #${receipt.id} created, printing...`);
            this._printReceipt(receipt.id);
            
            this._context.getWebClient()._updatePanel();
        }, this)
    );
};/**
 * @param receiptId {number}
 */
GameScreen.prototype._removeReceipt = function (receiptId) {
    this._context.getGameManager().deleteReceiptRequest(receiptId,
        $.proxy(
            function () {
            this._receipts = this._receipts.filter(function (receipt) {
                return receipt.id !== receiptId
            });
            this._view.removeReceipt(receiptId, this._getTotalValue());
            this._context.getWebClient()._updatePanel();
        }, this));
};

/**
 * @param receiptId {number}
 */
GameScreen.prototype._printReceipt = function (receiptId) {
    if (window.gameConfig && window.gameConfig.enableReceiptPrinting) {
        let createdTime = new Date().toLocaleString();
        $.get(this._receiptUrl + "/?action=print&id=" + receiptId + "&createdTime=" + createdTime, function (response) {
            printJS({printable: response, type: 'raw-html'});
        });
    }
};

/** @type {() => Big} */
GameScreen.prototype._getTotalValue = function () {
    return this._receipts.reduce(function (accumulated, receipt) {
        return accumulated.plus(receipt.getBetSum());
    }, new Big(0));
};

/**
 * @throws
 */
GameScreen.prototype._validateReceipts = function () {
    /* if (!this._receipts.length) {
        throw new GameScreen.ValidationError(Messages.NO_RECEIPTS);
    } */
};

/**
 * @param onStartRound {() => void}
 */
GameScreen.prototype._makeReceipts = function (onStartRound) {
    this._context.getGameManager().startRoundRequest(onStartRound);
};

/**
 * @param onAddBet {(number: number, value: Big) => void}
 * @param onRemoveBet {(number: number) => void}
 * @param onAddReceipt {() => void}
 * @param onRemoveReceipt {(receiptId: number) => void}
 * @param onPrintReceipt {(receiptId: number) => void}
 * @param onMakeReceipts {() => void}
 * @constructor
 */
let GameScreenView = function (onAddBet, onRemoveBet, onAddReceipt, onRemoveReceipt, onPrintReceipt, onMakeReceipts) {
    this._container = $(".game_screen");
    this._receiptTable = new GameScreenView.ReceiptTable(onRemoveReceipt, onPrintReceipt);
    /** @type {(number: number, value: Big) => void} */
    this._onAddBet = onAddBet;
    /** @type {(number: number) => void} */
    this._onRemoveBet = onRemoveBet;
    /** @type {() => void} */
    this._onAddReceipt = onAddReceipt;
    this._onPrintReceipt = onPrintReceipt;
    /** @type {() => void} */
    this._onMakeReceipts = onMakeReceipts;
};

GameScreenView.prototype.init = function () {
    this._container.on("submit", ".create", $.proxy(function (event) {
        let container = $(event.target).parents(".participant");
        let bet = this._getBet(container);
        if (bet) {
            this._onAddBet(bet.number, bet.value);
        }
        return false;
    }, this));
    this._container.on("keyup", ".create .value", function () {
        let hasValue = !!($(this).val().length);
        $(this).parents(".create:first").toggleClass("has_value", hasValue);
    });
    this._container.on("blur", ".create .value", $.proxy(function (event) {
        let container = $(event.target).parents(".participant");
        let bet = this._getBet(container);
        if (bet) {
            this._onAddBet(bet.number, bet.value);
        }
        return false;
    }, this));
    this._container.on("click", ".view .cancel", $.proxy(function (event) {
        let container = $(event.target).parents(".participant");
        let number = container.data("number");
        this._onRemoveBet(number);
    }, this));
    this._container.on("click", ".add_receipt", $.proxy(function () {
        if (!this._hasIncompleteBets()) {
            this._onAddReceipt();
        }
    }, this));
    this._container.on("click", ".added_receipts", $.proxy(function () {
        if (this._receiptTable.getReceiptCount() !== 0) {
            this._container.find(".receipts_container").addClass("active");
        }
    }, this));
    this._container.on("click", ".receipts_container", function () {
        $(this).removeClass("active");
    });
    this._container.on("click", ".start", $.proxy(function () {
        if (this._hasIncompleteBets()) {
            return;
        }
        if (this._hasIncompleteReceipts()) {
            this._onAddReceipt();
        }
        this._onMakeReceipts();
    }, this));
    this._receiptTable.init();
    this._container.addClass("active");
};

GameScreenView.prototype.deinit = function () {
    this._container.removeClass("active");
    this._receiptTable.deinit();
    this._container.find(".participants .participant").remove();
    this._container.find(".added_receipts .count").text("0");
    this._container.unbind();
};

/**
 * @returns {boolean}
 */
GameScreenView.prototype._hasIncompleteReceipts = function () {
    let result = false;
    this._container.find(".participant").each(function () {
        if ($(this).hasClass("has_bet")) {
            result = true;
            return false;
        }
        return true;
    });
    return result;
};

/**
 * @returns {boolean}
 */
GameScreenView.prototype._hasIncompleteBets = function () {
    let result = false;
    this._container.find(".participant").each(function () {
        let element = $(this);
        if (!element.hasClass("has_bet") && element.find(".bet .create .value").val()) {
            result = true;
            return false;
        }
        return true;
    });
    return result;
};

/**
 * @param container {JQuery<HTMLElement>}
 */
GameScreenView.prototype._getBet = function (container) {
    let value = container.find(".bet .create .value").val();
    if (!value) {
        return null;
    }
    try {
        const roundedValue = (new Big(value)).round(Currency.digits, 0);
        const transformedValue = Currency.publicToSystem(roundedValue);
        return {
            /** @type {number} */
            number: container.data("number"),
            value: transformedValue
        };
    } catch (e) {
        return null;
    }
};

/**
 * @param container {JQuery<HTMLElement>}
 * @param participant {import('./types').Participant}
 * @returns {JQuery<HTMLElement>}
 */
GameScreenView.prototype._updateParticipant = function (container, participant) {
    container.removeClass("js_template").addClass("participant number" + participant.number + " family" + participant.family);
    container.data("number", participant.number);
    container.find(".name").text(`№ ${participant.number} ${participant.name}`);
    container.find(".coeff").text(participant.coeff);
    container.find(".create .value").attr({
        min: 0,
        step: Currency.systemToPublic(1),
    })
    return container;
};

/**
 * @param participants {(import('./types').Participant)[]}
 */
GameScreenView.prototype._updateParticipants = function (participants) {
    const container = this._container.find(".participants");
    const template = container.find(".js_template");

    // S'assurer que le template est invisible
    template.hide();

    // Supprimer les anciens participants
    container.find(".participant").remove();

    // Ajouter les nouveaux
    participants.forEach(participant => {
        const clone = template.clone().show(); // on le rend visible
        container.append(this._updateParticipant(clone, participant));
    });
};


/**
 * @param game {import('./types').Game}
 */
GameScreenView.prototype.update = function (game) {
    this._updateParticipants(game.participants);
    this._receiptTable.update(game);
    console.log("GameScreenView updated with game:", game);
};

/**
 * @param number {number}
 * @param value {Big | null}
 * @param prize {Big | null}
 */
GameScreenView.prototype.setBet = function (number, value, prize) {
    let container = this._getParticipantContainer(number);
    container.toggleClass("has_bet", !!(value && prize));
    const parsedValue = value ? Currency.systemToPublic(value).toFixed(Currency.visibleDigits) : value;
    const parsedPrize = prize ? Currency.systemToPublic(prize).toFixed(Currency.visibleDigits) : prize;
    container.find(".bet .create .value").val(parsedValue);
    container.find(".bet .view .value").text(parsedPrize);
    container.find(".bet .view .prize").text(parsedPrize);
    if (!value) {
        container.find(".bet .create").removeClass("has_value");
        container.find(".bet .create .value").focus();
    }
};

/**
 * @param number {number}
 */
GameScreenView.prototype._getParticipantContainer = function (number) {
    return $(this._container.find(".participant").filter(function () {
        return $(this).data("number") === number;
    })[0]);
};

/**
 * @param receipt {import('./types').Receipt}
 * @param totalValue {Big}
 */
GameScreenView.prototype.addReceipt = function (receipt, totalValue) {
    this._receiptTable.addReceipt(receipt, totalValue);
    this._updateReceiptCount();
    this._onPrintReceipt(receipt.id)
};

/**
 * @param game {GameModel}
 * @param receipt {GameModel.ReceiptModel}
 */
GameScreenView.prototype._getNewReceiptData = function (game, receipt) {
    return {
        id: -1,
        game_id: game.id,
        /** FIXME: is there issue? ('receipt' has not 'number' property) */
        number: receipt.number,
        create_time: new Date().toLocaleString(),
        bets: receipt.bets.map(function (bet) {
            let participant = game.getParticipantByNumber(bet.number);
            return {
                participant: {
                    number: participant.number,
                    name: participant.name,
                    coeff: participant.coeff,
                },
                value: bet.value.toString(),
                prize: bet.value.times(participant.coeff),
            };
        }),
        total_value: receipt.getBetSum().toString()
    };
};

/**
 * @param receiptId {number}
 * @param totalValue {Big}
 */
GameScreenView.prototype.removeReceipt = function (receiptId, totalValue) {
    this.getReceiptTable().removeReceipt(receiptId);

    this.getReceiptTable()._updateTotalValue(totalValue);
    this._updateReceiptCount();
    if (!this._receiptTable.getReceiptCount()) {
        this._container.find(".receipts_container").removeClass("active");
    }
};

GameScreenView.prototype._updateReceiptCount = function () {
    this._container.find(".added_receipts .count").text(this._receiptTable.getReceiptCount());
};

GameScreenView.prototype.getReceiptTable = function () {
    return this._receiptTable;
};

/**
 * @param onRemoveReceipt {(receiptId: number) => unknown}
 * @param onPrintReceipt {(receiptId: number) => unknown}
 * @constructor
 */
GameScreenView.ReceiptTable = function (onRemoveReceipt, onPrintReceipt) {
    this._container = $(".game_screen .receipts");
    /** @type {import('./types').Participant['number'][]} */
    this._participantCols = [];
    /** @type {(receiptId: number) => unknown} */
    this._onRemoveReceipt = onRemoveReceipt;
    /** @type {(receiptId: number) => unknown} */
    this._onPrintReceipt = onPrintReceipt;
};

GameScreenView.ReceiptTable.prototype.init = function () {
    this._container.on("click", ".remove", $.proxy(function (event) {
        let receiptId = parseInt($(event.currentTarget).parents(".receipt:first").data("receipt-number"));
        this._onRemoveReceipt(receiptId);
        return false;
    }, this));
    this._container.on("click", ".repeat-print", $.proxy(function (event) {
        let receiptId = parseInt($(event.currentTarget).parents(".receipt:first").data("receipt-number"));
        this._onPrintReceipt(receiptId);
        return false;
    }, this));
};

GameScreenView.ReceiptTable.prototype.deinit = function () {
    this._container.empty();
    this._container.unbind();
    this._participantCols = [];
};

/**
 * @param game {GameModel}
 */
GameScreenView.ReceiptTable.prototype.update = function (game) {
    this._participantCols = game.participants.map(function (participant) {
        return participant.number;
    });
    let parts = game.participants.map(function (participant) {
        return `<td>№ ${participant.number} ${participant.name} (${participant.coeff})</td>`;
    });
    let repeatPrintText = '';
    if (window.gameConfig && window.gameConfig.enableReceiptPrinting) {
        repeatPrintText = '<td></td>'
    }
    this._container.append(`
        <tr>
            <td></td>
            ${parts.join("")}
            <td>${Messages.TOTAL}</td>
            ${repeatPrintText}
            <td></td>
        </tr>
        <tr class="footer">
            <td colspan="${game.participants.length + 1}"></td>
            <td class="total"></td>
            ${repeatPrintText}
            <td></td>
        </tr>
    `);
};

/**
 * @param receipt {GameModel.ReceiptModel}
 * @param totalValue {Big}
 */
GameScreenView.ReceiptTable.prototype.addReceipt = function (receipt, totalValue) {
    let parts = this._participantCols.map(function (number) {
        let bet = receipt.getBetForParticipant(number);
        return `<td>${bet ? Messages.MONEY_AMOUNT.replace("$value", Currency.systemToPublic(bet.value).toFixed(Currency.visibleDigits)) : ""}</td>`;
    });
    let repeatPrintText = '';
    if (window.gameConfig && window.gameConfig.enableReceiptPrinting) {
        repeatPrintText = '<td><button class="repeat-print"></button></td>'
    }
    this._container.find(".footer").before(`
        <tr data-receipt-number="${receipt.id}" class="receipt">
            <td class="number">№ ${receipt.id}</td>
            ${parts.join("")}
            <td>${Messages.MONEY_AMOUNT.replace("$value", Currency.systemToPublic(receipt.getBetSum()).toFixed(Currency.visibleDigits))}</td>
            ${repeatPrintText}
            <td>
                <button class="remove"></button>
            </td>
        </tr>
    `);
    this._updateTotalValue(totalValue);
};

/**
 * @param receiptId {import('./types').Receipt['id']}
 */
GameScreenView.ReceiptTable.prototype.removeReceipt = function (receiptId) {
    this._container.find(`.receipt[data-receipt-number=${receiptId}]`).remove();
};

/**
 * @param value {Big}
 */
GameScreenView.ReceiptTable.prototype._updateTotalValue = function (value) {
    this._container.find(".footer .total").text(Messages.MONEY_AMOUNT.replace("$value", Currency.systemToPublic(value).toFixed(Currency.visibleDigits)));
};

GameScreenView.ReceiptTable.prototype.getReceiptCount = function () {
    return this._container.find(".receipt").length;
};