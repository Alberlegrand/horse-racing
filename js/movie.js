let MovieScreen = function(context, onFinish) {
    Screen.call(this, context, new MovieScreenView(context, function() {
        onFinish();
    }));
};

MovieScreen.prototype.init = function() {
    this._view.init();
    this._view.update(this._context.getGameManager().getGame());
};

MovieScreen.prototype.deinit = function() {
    this._view.deinit();
};

let MovieScreenView = function(context, onFinish) {
    this._container = $(".movie_screen");
    this._movie = new Movie(context, $.proxy(function() {
        this._container.addClass("skippable");
    }, this), $.proxy(function() {
        this._movie.deinit();
        this._onFinish();
    }, this));
    this._onFinish = onFinish;
};

MovieScreenView.prototype.init = function() {
    this._container.on("click", ".skip", $.proxy(function() {
        this._movie.deinit();
        this._onFinish();
    }, this));
    this._container.addClass("active");
};

MovieScreenView.prototype.deinit = function() {
    this._movie.deinit();
    this._container.removeClass("skippable active");
    this._container.unbind();
};

MovieScreenView.prototype.update = function(game) {
    this._movie.init(game, this._container.find(".movie")[0]);
    console.log("MovieScreenView updated with game:", game);
};
