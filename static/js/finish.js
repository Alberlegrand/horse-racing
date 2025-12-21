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
    try {
        var winner = game.getWinner();
        
        // ✅ CORRECTION CRITIQUE: Émettre l'événement round_winner avec le gagnant de game.getWinner()
        // Cet événement est écouté par screen.html qui met à jour la liste des gagnants
        // Cela garantit que la liste des gagnants affiche EXACTEMENT le même gagnant que le finish_screen
        
        // Déduplication : n'émettre que si l'id du round n'a pas déjà été traité
        if (!window.__shownRoundWinnersSet) window.__shownRoundWinnersSet = new Set();
        
        if (!window.__shownRoundWinnersSet.has(game.id)) {
            window.__shownRoundWinnersSet.add(game.id);
            
            console.log(`🎯 [FINISH-SCREEN] Émission du winner au historique:`);
            console.log(`   Round: ${game.id}, Winner: №${winner?.number} ${winner?.name} (Family: ${winner?.family})`);
            
            $(document).trigger('round_winner', [{
                id: game.id,
                winner: {
                    number: winner && winner.number,
                    name: winner && winner.name,
                    family: winner && winner.family
                }
            }]);
            
            console.log(`✅ [FINISH-SCREEN] Événement round_winner émis (déduplication active)`);
        }
    } catch (e) {
        console.error(`❌ [FINISH-SCREEN] Erreur lors de l'émission du winner:`, e);
    }
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
    console.log("Updating receipts for game:", game);
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
    console.log("Total prize calculated:", totalPrize);
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
    // AJOUT DE LA VÉRIFICATION : Ne rien faire si 'receipts' est nul ou vide.
    if (!game.receipts || game.receipts.length === 0) {
        return; 
    }
    
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


