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

// ✅ Amélioré avec retry logic, health monitoring, et error recovery
WebClient.prototype._activateKeepAlive = function (keepAliveUrl, keepAliveTick, keepAliveTimeout) {
    if (this._keepAliveTimer) {
        clearInterval(this._keepAliveTimer);
    }
    
    // État du keepalive
    this._keepAliveState = {
        consecutiveFailures: 0,
        maxRetries: 2,
        lastSuccessTime: Date.now(),
        serverHealthStatus: 'healthy'
    };

    this._keepAliveTimer = setInterval($.proxy(function () {
        this._performKeepAliveCheck(keepAliveUrl, keepAliveTick, keepAliveTimeout);
    }, this), keepAliveTick);
};

// ✅ Nouvelle fonction: Effectuer un check keepalive avec retry
WebClient.prototype._performKeepAliveCheck = function (keepAliveUrl, keepAliveTick, keepAliveTimeout) {
    const maxRetries = this._keepAliveState.maxRetries;
    let attempt = 0;

    const tryKeepAlive = $.proxy(function () {
        attempt++;
        
        $.ajax({
            type: "GET",
            url: keepAliveUrl + "?dt=" + Math.random(),
            contentType: "application/json",
            dataType: "json",
            timeout: keepAliveTimeout,
            async: true,
            success: $.proxy(function (response) {
                // ✅ Réinitialiser le compteur de failures
                this._keepAliveState.consecutiveFailures = 0;
                this._keepAliveState.lastSuccessTime = Date.now();

                if (response && response.data) {
                    // Vérifier la santé du serveur
                    if (response.data.serverHealth && response.data.serverHealth !== 'healthy') {
                        this._keepAliveState.serverHealthStatus = response.data.serverHealth;
                        console.warn('[keepalive] Server health: ' + response.data.serverHealth);
                    }

                    let changed = false;
                    if (response.data.keepAliveTick && keepAliveTick !== response.data.keepAliveTick) {
                        keepAliveTick = response.data.keepAliveTick;
                        changed = true;
                    }
                    if (response.data.keepAliveTimeout && keepAliveTimeout !== response.data.keepAliveTimeout) {
                        keepAliveTimeout = response.data.keepAliveTimeout;
                        changed = true;
                    }
                    if (response.data.keepAliveUrl && keepAliveUrl !== response.data.keepAliveUrl) {
                        keepAliveUrl = response.data.keepAliveUrl;
                        changed = true;
                    }
                    if (changed) {
                        this._activateKeepAlive(keepAliveUrl, keepAliveTick, keepAliveTimeout);
                    }
                }
            }, this),
            
            error: $.proxy(function (xhr, status, error) {
                this._keepAliveState.consecutiveFailures++;
                
                // Log les erreurs
                console.warn(
                    '[keepalive] Attempt ' + attempt + '/' + (maxRetries + 1) + ' failed: ' + 
                    (status || error || xhr.status)
                );

                // Retry si nous n'avons pas atteint le max
                if (attempt < maxRetries + 1) {
                    // Attendre 500ms avant de retry
                    setTimeout(tryKeepAlive, 500);
                } else {
                    // Tous les retries échoués
                    console.error('[keepalive] All ' + (maxRetries + 1) + ' attempts failed. Server may be unreachable.');
                    
                    // Marquer comme problématique mais ne pas déconnecter immédiatement
                    if (this._keepAliveState.consecutiveFailures > 5) {
                        console.error('[keepalive] Too many consecutive failures. Triggering reload.');
                        // Attendre 5s avant de recharger (laisser une chance à la connexion)
                        setTimeout(function() {
                            if (this._keepAliveState.consecutiveFailures > 5) {
                                window.location.reload();
                            }
                        }, 5000);
                    }
                }
            }, this)
        });
    }, this);

    // Démarrer le premier essai
    tryKeepAlive();
};

Settings = {
    assetPath: "",
    receiptUrl: "",
    limits: new LimitModel(0, 0),
    keepAliveUrl: "",
    keepAliveTick: 0,
    keepAliveTimeout: 0
};