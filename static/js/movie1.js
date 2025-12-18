let GameParams = {
    START_OFFSET: -80,
    TRACK_LENGTH: 10000,
    TRACK_WIDTH: 500
};

let ViewportUpdater = function (viewport, onFinish) {
    this._finishTime = null;
    this._viewport = viewport;
    this._onFinish = onFinish;
};

ViewportUpdater.VIEWPORT_PADDING = 30;
ViewportUpdater.START_DELAY = 1;
ViewportUpdater.FINISH_DELAY = 2;
        

ViewportUpdater.prototype._getCameraCenterByGroup = function (entities) {
    let min = 1e9;
    let max = 0;
    for (let i in entities) {
        if (entities.hasOwnProperty(i)) {
            let entity = entities[i];
            min = Math.min(entity.x, min);
            max = Math.max(entity.x + entity.getWidth(), max);
        }
    }
    return (min + max) / 2;
};

ViewportUpdater.prototype._getCameraCenterByFavorite = function (entities) {
    let max = 0;
    for (let i in entities) {
        if (entities.hasOwnProperty(i)) {
            let entity = entities[i];
            max = Math.max(max, entity.x + entity.getWidth() + ViewportUpdater.VIEWPORT_PADDING);
        }
    }
    return max - this._viewport.width / 2;
};

ViewportUpdater.prototype._getCameraCenter = function (entities) {
    return Math.max(this._getCameraCenterByGroup(entities), this._getCameraCenterByFavorite(entities));
};

ViewportUpdater.prototype._isFinish = function () {
    return -this._viewport.x + ViewportUpdater.VIEWPORT_PADDING >= GameParams.TRACK_LENGTH;
};

ViewportUpdater.prototype.update = function (entities, elapsed) {
    if (this._isFinish()) {
        if (this._finishTime == null) {
            this._finishTime = elapsed;
        }
        if (elapsed - this._finishTime >= ViewportUpdater.FINISH_DELAY) {
            // ✅ CORRECTION: Ne pas appeler onFinish si WebSocket gère les transitions
            // Cela évite le double affichage de finish_screen
            if (window.websocketManagedTransitions) {
                console.log('⚠️ [ViewportUpdater] onFinish ignoré - WebSocket gère les transitions');
                return; // Ne pas appeler onFinish, laisser WebSocket gérer
            }
            this._onFinish();
        }
    } else {
        let halfWidth = this._viewport.width / 2;
        this._viewport.x = halfWidth - Math.min(Math.max(this._getCameraCenter(entities), halfWidth), GameParams.TRACK_LENGTH + halfWidth);
    }
};

let Movie = function (context, onStart, onFinish) {
    this._context = context;
    this._onStart = onStart;
    this._interval = null;
    this._pathGenerator = new PathGenerator();
    this._viewportUpdater = new ViewportUpdater(Crafty.viewport, function () {
        onFinish();
    });
};

Movie.WIDTH = 800;
Movie.HEIGHT = 500;

Movie.prototype._createLoadingScene = function () {
    let builder = new LoadingSceneBuilder(this._context);
    builder.build();
};

Movie.prototype._createGameScene = function (game, onReady) {
    let builder = new GameSceneBuilder(game, onReady);
    builder.build();
};

Movie.prototype._generatePaths = function (participants) {
    let paths = this._pathGenerator.generateAll(participants.length);
    paths.sort(function (a, b) {
        return a.getTime(GameParams.TRACK_LENGTH) > b.getTime(GameParams.TRACK_LENGTH) ? 1 : -1;
    });
    let result = {};
    for (let i = 0; i < participants.length; i += 1) {
        let participant = participants[i];
        let path = paths[participant.place - 1];
        if (participant.place === 1) {
            this._pathGenerator.setFastOnFinish(path);
        }
        result[participant.number] = path;
    }
    return result;
};

Movie.prototype._updateParticipantPosition = function (entity, path, elapsed) {
    entity.attr({x: path.getOffset(elapsed)});
};

Movie.prototype._updateAnimationSpeed = function (entity) {
    entity.setAnimationSpeed(16);
};

Movie.prototype._setupLoop = function (entities, paths) {
    let timestamp = (new Date()).getTime();
    this._interval = setInterval($.proxy(function () {
        let elapsed = ((new Date).getTime() - timestamp) / 1000 - ViewportUpdater.START_DELAY;
        if (elapsed < 0) {
            return;
        }
        for (let id in entities) {
            if (entities.hasOwnProperty(id)) {
                let entity = entities[id];
                if (paths.hasOwnProperty(id)) {
                    let path = paths[id];
                    this._updateParticipantPosition(entity, path, elapsed);
                    this._updateAnimationSpeed(entity);
                }
            }
        }
        this._viewportUpdater.update(entities, elapsed);
    }, this), 1);
};

Movie.prototype._start = function (container) {
    Crafty.init(Movie.WIDTH, Movie.HEIGHT, container);
    Crafty.background("black");
    if ($.isEmptyObject(Crafty.assets)) {
        Crafty.scene("loading");
    } else {
        Crafty.scene("game");
    }
    $('.panel').hide();
    window.scrollTo(0,1);
};

Movie.prototype.init = function (game, container) {

    // Crée la scène de chargement pendant la récupération des données
    this._createLoadingScene();

    // 🔹 Étape 1 : récupérer les données du round depuis GameManager
    this._context.getGameManager().getRoundRequest($.proxy(function (responseGame) {
        // Remplace les données "game" locales par celles du serveur
        game = responseGame;

        // 🔹 Étape 2 : construire la scène de jeu avec les vraies données
        this._createGameScene(game, $.proxy(function (entities) {
            let paths = this._generatePaths(game.participants);

            // 🔹 Étape 3 : démarrer la boucle principale d’animation
            this._setupLoop(entities, paths);
            this._onStart();
        }, this));

        // 🔹 Étape 4 : lancer l’affichage du jeu
        this._start(container);

    }, this));
};


Movie.prototype.deinit = function () {
    clearInterval(this._interval);
    $('.panel').show();
    Crafty.stop();
};
