let WebClient = function () {
    this._context = null;
    this._screen = null;
    this._panel = new Panel();
    this._message = {};
    this._keepAliveTimer = null;
};

WebClient.prototype.init = function (settings, messages) {
    this._message = messages;
    this._createContext(settings);
    this._panel.init();
    this._activateGameScreen();
    $.proxy(this._activateKeepAlive(settings.keepAliveUrl, settings.keepAliveTick, settings.keepAliveTimeout), this);
};

WebClient.prototype._createContext = function (settings) {
    let indicator = new LoadingIndicator();
    let server = new Server(
        function () {
            indicator.show();
        },
        function () {
            indicator.hide();
        },
        $.proxy(function (e, eStatus) {
            if (eStatus === "timeout") {
                this._context.getNotifier().showError(this.getMessage("AJAX_TIMEOUT"));
            } else if (e.status !== 200) {
                let error = JSON.parse(e.responseText);
                this._context.getNotifier().showError(error.message);
            }
        }, this),
        $.proxy(function () {
            window.location.reload();
        }, this)
    );
    this._context = new Context(this, settings, server);
};

WebClient.prototype._activateScreen = function (screen) {
    if (this._screen != null) {
        this._screen.deinit();
    }
    this._screen = screen;
    this._screen.init();
};

WebClient.prototype._activateGameScreen = function () {
    let screen = new GameScreen(this._context, $.proxy(this._updatePanel, this), $.proxy(this._activateMovieScreen, this));
    this._activateScreen(screen);
};

WebClient.prototype._activateMovieScreen = function () {
    let screen = new MovieScreen(this._context, $.proxy(this._activateFinishScreen, this));
    this._activateScreen(screen);
};

WebClient.prototype._activateFinishScreen = function () {
    // ✅ Activer finish_screen normalement - le système de screens gère la transition
    let screen = new FinishScreen(this._context, $.proxy(this._updatePanel, this), $.proxy(this._activateGameScreen, this));
    this._activateScreen(screen);
};

WebClient.prototype._updatePanel = function () {
    this._context.getGameManager().getMoneyRequest(
        $.proxy(
            /** @param money {import('./types').MoneyResponse['money']} */
            function (money) {
                this._context.getUserManager().setMoney(money);
                this._panel.update(this._context.getGameManager().getGame(), this._context.getUserManager().getMoney());
            },
            this
        )
    );
};

WebClient.prototype.getMessage = function (message) {
    if (this._message.hasOwnProperty(message)) {
        return this._message[message];
    }
    return message + " is untranslated";
};

WebClient.prototype._activateKeepAlive = function (keepAliveUrl, keepAliveTick, keepAliveTimeout) {
    if (this._keepAliveTimer) {
        clearInterval(this._keepAliveTimer);
    }
    this._keepAliveTimer =
        setInterval($.proxy(function () {
            $.ajax({
                type: "GET",
                url: keepAliveUrl + "&dt=" + Math.random(),
                contentType: "application/json",
                dataType: "json",
                timeout: keepAliveTimeout,
                async: true,
                success: $.proxy(function (response) {
                    if (response && response.data) {
                        let changed = false;
                        if (response.data.keepAliveTick && keepAliveTick !== response.data.keepAliveTick) {
                            keepAliveTick = response.data.keepAliveTick;
                            changed = true;
                        }
                        if (response.data.keepAliveTick && keepAliveTimeout !== response.data.keepAliveTimeout) {
                            keepAliveTimeout = response.data.keepAliveTimeout;
                            changed = true;
                        }
                        if (response.data.keepAliveTick && keepAliveUrl !== response.data.keepAliveUrl) {
                            keepAliveUrl = response.data.keepAliveUrl;
                            changed = true;
                        }
                        if (changed) {
                            this._activateKeepAlive(keepAliveUrl, keepAliveTick, keepAliveTimeout);
                        }
                    }
                }, this)
            });
        }, this), keepAliveTick);
};

Settings = {
    assetPath: "",
    receiptUrl: "",
    limits: new LimitModel(0, 0),
    keepAliveUrl: "",
    keepAliveTick: 0,
    keepAliveTimeout: 0
};