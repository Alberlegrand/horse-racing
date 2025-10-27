let LoadingSceneBuilder = function(context) {
    this._context = context;
};

LoadingSceneBuilder.prototype._getAssetPath = function(number) {
    /* return `${this._context.getSettings().assetPath}/${number}.png`; */
    return `/img/${number}.png`;
};

LoadingSceneBuilder.prototype._getAssets = function() {
    let assets = [];
    for (let i = 1; i <= 4; i += 1) {
        assets.push(this._getAssetPath(i));
    }
    return assets;
};

LoadingSceneBuilder.prototype._getImageCopy = function(image, x, y, width, height) {
    let canvas = document.createElement("canvas");
    canvas.width = width || image.width;
    canvas.height = height || image.height;
    canvas.getContext("2d").drawImage(image, x || 0, y || 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas;
};

LoadingSceneBuilder.prototype._createCroppedCopy = function(source, x, y, width, height, destination, onCreate) {
    let copy = this._getImageCopy(Crafty.asset(source), x, y, width, height);
    let result = new Image();
    result.onload = function() {
        Crafty.asset(destination, result);
        onCreate();
    };
    result.src = copy.toDataURL();
};

LoadingSceneBuilder.prototype._createSpriteFromCropped = function(source, x, y, width, height, name, onCreate) {
    this._createCroppedCopy(source, x, y, width, height, name, function() {
        let map = {};
        map[name] = [0, 0];
        Crafty.sprite(width / 4, height / 4, name, map);
        onCreate();
    });
};

LoadingSceneBuilder.prototype._getColorMask = function(image, color) {
    let canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    let context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "destination-atop";
    context.drawImage(image, 0, 0);
    return canvas;
};

LoadingSceneBuilder.prototype._createColorizedCopy = function(source, color, destination, onCreate) {
    let asset = Crafty.asset(source);
    let mask = this._getColorMask(asset, color);
    let copy = this._getImageCopy(asset);
    let context = copy.getContext("2d");
    context.globalAlpha = 0.3;
    context.drawImage(mask, 0, 0);
    let result = new Image();
    result.onload = function() {
        Crafty.asset(destination, result);
        onCreate();
    };
    result.src = copy.toDataURL();
};

LoadingSceneBuilder.prototype._createCroppedAndColorizedCopy = function(source, x, y, width, height, color, destination, onCreate) {
    let cropName = "Gray" + destination;
    this._createCroppedCopy(source, x, y, width, height, cropName, $.proxy(function() {
        this._createColorizedCopy(cropName, color, destination, onCreate);
    }, this));
};

LoadingSceneBuilder.prototype._createSpriteFromCroppedAndColorized = function(source, x, y, width, height, color, name, onCreate) {
    this._createCroppedAndColorizedCopy(source, x, y, width, height, color, name, function() {
        let map = {};
        map[name] = [0, 0, width, height];
        Crafty.sprite(name, map);
        onCreate();
    });
};

LoadingSceneBuilder.prototype._createAnimatedSpriteFromCroppedAndColorized = function(source, x, y, width, height, color, name, onCreate) {
    this._createCroppedAndColorizedCopy(source, x, y, width, height, color, name, function() {
        let map = {};
        map[name] = [0, 0];
        Crafty.sprite(width / 4, height / 4, name, map);
        onCreate();
    });
};

LoadingSceneBuilder.prototype._createStaticSprites = function(onCreate) {
    Crafty.sprite(this._getAssetPath(1), {
        OutsideSprite: [179, 873, 187, 93],
        TrackSprite: [0, 874, 179, 145],
        StallSprite: [0, 760, 80, 113],
        FinishFlagSprite: [179, 760, 120, 111],
        FinishLineSprite: [300, 760, 93, 47],
        ShadowSprite: [300, 807, 100, 50],
        BetMarkSprite: [400, 807, 18, 23],
        BannerSprite: [400, 760, 281, 34],
        FinishBannerSprite: [400, 873, 488, 91]
    });
    onCreate();
};

LoadingSceneBuilder.prototype._createStallClothSprites = function(onCreate) {
    let tasks = [];
    for (let i = 0; i < ParticipantColors.colors.length; i += 1) {
        tasks.push($.proxy(function(i) {
            return $.proxy(function(callback) {
                let color = ParticipantColors.colors[i];
                this._createSpriteFromCroppedAndColorized(this._getAssetPath(1), 80, 760, 95, 84, color, "StallCloth" + i + "Sprite", callback);
            }, this);
        }, this)(i));
    }
    async.parallel(tasks, onCreate);
};

LoadingSceneBuilder.prototype._createHorseSprite = function(onCreate) {
    this._createSpriteFromCropped(this._getAssetPath(3), 0, 390, 800, 530, "HorseSprite", onCreate);
};

LoadingSceneBuilder.prototype._createDecorSprites = function(onCreate) {
    let tasks = [];
    for (let i = 0; i < ParticipantColors.colors.length; i += 1) {
        tasks.push($.proxy(function(i) {
            return $.proxy(function(callback) {
                let color = ParticipantColors.colors[i];
                this._createAnimatedSpriteFromCroppedAndColorized(this._getAssetPath(4), 0, 390, 700, 470, color, "Decor" + i + "Sprite", callback);
            }, this);
        }, this)(i));
    }
    async.parallel(tasks, onCreate);
};

LoadingSceneBuilder.prototype._createRiderSprites = function(onCreate) {
    async.parallel([
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(1), 0, 0, 780, 400, "Rider0Sprite", callback);
        }, this),
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(2), 0, 0, 670, 350, "Rider1Sprite", callback);
        }, this),
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(1), 0, 400, 800, 360, "Rider2Sprite", callback);
        }, this),
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(2), 0, 400, 890, 360, "Rider3Sprite", callback);
        }, this),
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(3), 0, 0, 890, 390, "Rider4Sprite", callback);
        }, this),
        $.proxy(function(callback) {
            this._createSpriteFromCropped(this._getAssetPath(4), 0, 0, 680, 390, "Rider5Sprite", callback);
        }, this)
    ], onCreate);
};

LoadingSceneBuilder.prototype.build = function() {
    Crafty.scene("loading", $.proxy(function() {
        let indicator = Crafty.e("LoadingIndicator");
        Crafty.load(this._getAssets(), $.proxy(function() {
            async.parallel([
                $.proxy(this._createStaticSprites, this),
                $.proxy(this._createStallClothSprites, this),
                $.proxy(this._createHorseSprite, this),
                $.proxy(this._createDecorSprites, this),
                $.proxy(this._createRiderSprites, this)
            ], function() {
                Crafty.scene("game");
            });
        }, this), function(progress) {
            indicator.text(progress.percent + "%");
        });
    }, this));
};

let GameSceneBuilder = function(game, onReady) {
    console.log("game scene builder :", game);
    this._game = game;
    this._onReady = onReady;
};

GameSceneBuilder.prototype.build = function() {
    Crafty.scene("game", $.proxy(function() {
        Crafty.viewport.x = 0;
        this._addTrack();
        this._addOutside();
        this._addBanners();
        this._addFinishFlag();
        this._addFinishLine();
        let entities = this._addParticipants(this._game.participants);
        this._onReady(entities);
    }, this));
};

GameSceneBuilder.prototype._addTrack = function() {
    for (let x = 0; x < GameParams.TRACK_LENGTH + 1000; x += 179) {
        for (let y = 0; y < GameParams.TRACK_WIDTH; y += 145) {
            Crafty.e("Track").attr({x: x, y: y});
        }
    }
};

GameSceneBuilder.prototype._addOutside = function() {
    for (let x = 0; x < GameParams.TRACK_LENGTH + 1000; x += 187) {
        Crafty.e("Outside").attr({x: x});
    }
};

GameSceneBuilder.prototype._addBanners = function() {
    for (let i = 2291; i < GameParams.TRACK_LENGTH + 1000; i += 2244) {
        Crafty.e("Banner").attr({x: i, y: 50});
    }
    Crafty.e("FinishBanner").attr({x: GameParams.TRACK_LENGTH + 200});
};

GameSceneBuilder.prototype._addFinishFlag = function() {
    Crafty.e("FinishFlag").attr({x: GameParams.TRACK_LENGTH, y: -10});
};

GameSceneBuilder.prototype._addFinishLine = function() {
    for (let y = 93; y < 500; y += 47) {
        Crafty.e("FinishLine").attr({x: GameParams.TRACK_LENGTH, y: y});
    }
};

GameSceneBuilder.prototype._addParticipants = function(participants) {
    let entities = {};
    for (let i = 0; i < participants.length; i += 1) {
        let participant = participants[i];
        entities[participant.number] = this._addParticipant(participant, i);
        this._addStall(participant, i);
    }
    return entities;
};

GameSceneBuilder.prototype._addParticipant = function(participant, index) {
    let entity = Crafty.e("Participant");
    entity.setDecor(index + 1);
    entity.setRider(participant.family);
    entity.setNumber(participant.number);
    if (this._game.hasBetsForParticipant(participant.number)) {
        entity.setHasBet();
    }
    entity.attr({
        x: GameParams.START_OFFSET,
        y: 50 + 50 * (index + 1)
    });
    return entity;
};

GameSceneBuilder.prototype._addStall = function(participant, index) {
    let entity = Crafty.e("Stall");
    entity.setCloth(index + 1);
    entity.attr({
        x: Math.random() * -5,
        y: 75 + 50 * (index + 1)
    });
};
