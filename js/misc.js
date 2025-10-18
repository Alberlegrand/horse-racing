let LoadingIndicator = function() {
    this._count = 0;
};

LoadingIndicator.prototype.show = function() {
    if (this._count === 0) {
        $("body").addClass("loading");
    }
    this._count++;
};

LoadingIndicator.prototype.hide = function() {
    this._count--;
    if (this._count === 0) {
        $("body").removeClass("loading");
    }
};

let Notifier = function() {
    this._container = $(".notification_container");
    this._notification = null;
    $(document).on("keyup", $.proxy(function(event) {
        if (event.which === 27 && this._notification && this._notification.hasClass("active")) {
            this._hide();
        }
    }, this));
    $(document).on("click", $.proxy(function() {
        if (this._notification && this._notification.hasClass("active")) {
            this._hide();
        }
    }, this));
};

Notifier.prototype._create = function(message, style) {
    let notification = this._container.find(".js_template").clone();
    notification.removeClass("js_template").addClass("notification " + style);
    notification.find(".message").html(message);
    this._container.append(notification);
    return notification;
};

Notifier.prototype._show = function(message, style) {
    this._hide();
    let notification = this._create(message, style);
    notification.fadeIn("fast", $.proxy(function() {
        notification.addClass("active");
    }, this));
    notification.css({
        "margin-left": -notification.width() / 2,
        "margin-top": -notification.height() / 2
    });
    this._notification = notification;
};

Notifier.prototype._hide = function() {
    if (this._notification) {
        this._notification.fadeOut("fast", function() {
            $(this).remove();
        });
        this._notification = null;
    }
};

Notifier.prototype.showMessage = function(message) {
    this._show(message, "message");
};

Notifier.prototype.showError = function(message) {
    this._show(message, "error");
};

let ParticipantColors = {

    colors: ["#4D4CFF", "#FF4C4D", "#54D1E4", "#A2F069", "#F1E23E", "#F496FF"],

    getColor: function(participant) {
        return ParticipantColors.colors[participant.number - 1];
    }
};

let Screen = function(context, view) {
    this._context = context;
    this._view = view;
};

let Panel = function() {
    this._container = $(".panel");
};

Panel.prototype.init = function() {
    this._container.on("click", ".toggle_menu", $.proxy(function() {
        this._container.find(".menu_items").toggleClass("active");
    }, this));

    this._container.on("click", ".btn_return_url", function() {
        window.location.href = window.gameConfig.returnUrl;
    });

    var isFramed = false;
    try {
        isFramed = window != window.top || document != top.document || self.location != top.location;
    } catch (e) {
        isFramed = true;
    }
    if (isFramed && document.getElementsByClassName('btn_return_url') && document.getElementsByClassName('btn_return_url')[0]) {
        document.getElementsByClassName('btn_return_url')[0].style.display='none';
    }
};

/**
 * @param game {GameModel}
 * @param money {Big}
 */
Panel.prototype.update = function(game, money) {
    this._container.find(".title").text(Messages.TITLE.replace("$id", game.id));
    this._container.find(".money").text(Messages.MONEY_AMOUNT.replace("$value", money));
};
