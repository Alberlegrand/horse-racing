let Context = function(webclient, settings, server) {
    this._webclient = webclient;
    this._settings = settings;
    this._gameManager = new GameManager(server, this);
    this._userManager = new UserManager();
    this._notifier = new Notifier();
};

Context.prototype.getWebClient = function() {
    return this._webclient;
};


Context.prototype.getSettings = function() {
    return this._settings;
};

Context.prototype.getGameManager = function() {
    return this._gameManager;
};

Context.prototype.getUserManager = function() {
    return this._userManager;
};

Context.prototype.getNotifier = function() {
    return this._notifier;
};
