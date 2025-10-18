let FinishScreen = function (context, onInit, onNewGame) {
    Screen.call(this, context, new FinishScreenView(function () {
        onNewGame();
    }));
    this._onInit = onInit;
};

FinishScreen.prototype.init = function () {
    this._view.init();
    this._view.update(this._context.getGameManager().getGame());
    this._onInit();
};

FinishScreen.prototype.deinit = function () {
    this._view.deinit();
};

let FinishScreenView = function (onNewGame) {
    this._container = $(".finish_screen");
    this._onNewGame = onNewGame;
};

FinishScreenView.prototype.init = function () {
    this._container.on("click", ".new_game", $.proxy(function () {
        this._onNewGame();
    }, this));
    this._container.addClass("active");
};

FinishScreenView.prototype.deinit = function () {
    this._container.removeClass("active");
    this._removeFamilyClass();
    this._container.find(".receipts").empty();
    this._container.unbind();
};

FinishScreenView.prototype._removeFamilyClass = function () {
    let container = this._container.find(".winner");
    let classNames = container.attr("class").split(" ").filter(function (className) {
        return !className.startsWith("family");
    }).join(" ");
    container.attr("class", classNames);
};

FinishScreenView.prototype.update = function (game) {
    this._updateTitle(game.id);
    this._updateWinner(game.getWinner());
    this._updateReceipts(game);
};

FinishScreenView.prototype._updateTitle = function (gameId) {
    this._container.find(".title").text(Messages.WINNER.replace("$id", gameId));
};

FinishScreenView.prototype._updateWinner = function (winner) {
    let container = this._container.find(".winner");
    container.addClass("family" + winner.family);
    container.find(".name").text(`№ ${winner.number} ${winner.name}`);
};

FinishScreenView.prototype._updateReceipts = function (game) {
    this._updateReceiptTableHeader(game);
    this._updateReceiptTableBody(game);
};

FinishScreenView.prototype._updateReceiptTableHeader = function (game) {
    let winner = game.getWinner();
    let parts = game.participants.map(function (participant) {
        let result = "<td";
        if (winner.number === participant.number) {
            result += ' class="win"';
        }
        result += ">№ " + participant.number + " " + participant.name + " (" + participant.coeff + ")</td>";
        return result;
    });
    const totalPrize = Currency.systemToPublic(game.getTotalPrize()).toFixed(Currency.visibleDigits);
    this._container.find(".receipts").append(`
        <tr>
            <td></td>
            ${parts.join("")}
            <td>${Messages.PAYOUT}</td>
        </tr>
        <tr class="footer">
            <td colspan="${game.participants.length + 1}"></td>
            <td>${Messages.MONEY_AMOUNT.replace("$value", totalPrize)}</td>
        </tr>
    `)
};

FinishScreenView.prototype._updateReceiptTableBody = function (game) {
    let winner = game.getWinner();
    let rows = game.receipts.map(function (receipt) {
        let parts = game.participants.map(function (participant) {
            let bet = receipt.getBetForParticipant(participant.number);
            let result = "<td";
            if (winner.number === participant.number) {
                result += ' class="win"';
            }
            result += ">";
            if (bet) {
                result += Messages.MONEY_AMOUNT.replace("$value", Currency.systemToPublic(bet.value).toFixed(Currency.visibleDigits));
            }
            result += "</td>";
            return result;
        });
        return `
            <tr>
                <td>№ ${receipt.id}</td>
                ${parts.join("")}
                <td>${receipt.prize ? Messages.MONEY_AMOUNT.replace("$value", Currency.systemToPublic(receipt.prize).toFixed(Currency.visibleDigits)) : ""}</td>
            </tr>
        `;
    });
    this._container.find(".footer").before(rows);
};
