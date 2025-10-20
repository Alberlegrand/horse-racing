Crafty.c("Common", {

    init: function() {
        this.requires("2D, Canvas");
    }
});

Crafty.c("LoadingIndicator", {

    init: function() {
        this.requires("Common, Text")
            .attr({
                x: Crafty.viewport.width - 90,
                y: Crafty.viewport.height - 30
            })
            .textFont({
                size: "30px",
                family: "Scada"
            })
            .textColor("#FFFFFF", 1);
    }
});

Crafty.c("Outside", {

    init: function() {
        this.requires("Common, OutsideSprite");
    }
});

Crafty.c("Track", {

    init: function() {
        this.requires("Common, TrackSprite");
    }
});

Crafty.c("Stall", {

    init: function() {
        this.requires("Common, StallSprite");

    },

    setCloth: function(number) {
        this.attach(Crafty.e("Common, StallCloth" + (number - 1) + "Sprite").attr({x: -5, y: 0}));
        return this;
    }
});

Crafty.c("FinishFlag", {

    init: function() {
        this.requires("Common, FinishFlagSprite");
    }
});

Crafty.c("FinishLine", {

    init: function() {
        this.requires("Common, FinishLineSprite");
    }
});

Crafty.c("Banner", {

    init: function() {
        this.requires("Common, BannerSprite");
    }
});

Crafty.c("FinishBanner", {

    init: function() {
        this.requires("Common, FinishBannerSprite");
    }
});

Crafty.c("ParticipantPart", {

    init: function() {
        this.requires("Common, SpriteAnimation");
    }
});

Crafty.c("Horse", {

    init: function() {
        this.requires("ParticipantPart, HorseSprite");
    }
});

Crafty.c("Shadow", {

    init: function() {
        this.requires("Common, ShadowSprite");
        this.alpha = 0.2;
    }
});

Crafty.c("BetMark", {

    init: function() {
        this.requires("Common, BetMarkSprite");
    }
});

Crafty.c("ParticipantNumber", {

    init: function() {
        this.requires("Common, Text").textColor("#ffffff").textFont({size: "30px", family: "Scada"});
    },

    setNumber: function(number) {
        this.text(number);
        return this;
    }
});

Crafty.c("Participant", {

    init: function() {
        this.requires("Common")
            .attach(Crafty.e("Shadow").attr({x: 50, y: 95}))
            .attach(Crafty.e("Horse"));
        this._width = null;
        this._updateWidth();
    },

    _updateWidth: function() {
        let left = 10e9;
        let right = 0;
        for (let i = 0; i < this._children.length; i += 1) {
            let child = this._children[i];
            left = Math.min(left, child.x);
            right = Math.max(right, child.x + child.w);
        }
        this._width = right - left;
    },

    getWidth: function() {
        return this._width;
    },

    setDecor: function(number) {
        this.attach(Crafty.e("ParticipantPart, Decor" + (number - 1) + "Sprite").attr({x: 18, y: 5}));
        this._updateWidth();
        return this;
    },

    setRider: function(family) {
        let coords = this._getRiderCoords(family);
        this.attach(Crafty.e("ParticipantPart, Rider" + family + "Sprite").attr({x: coords[0], y: coords[1]}));
        this._updateWidth();
        return this;
    },

    _getRiderCoords: function(family) {
        if (family === 0) {
            return [-5, -20];
        }
        if (family === 1) {
            return [18, -12];
        }
        if (family === 2) {
            return [-10, -15];
        }
        if (family === 3) {
            return [-30, -12];
        }
        if (family === 4) {
            return [-32, -25];
        }
        if (family === 5) {
            return [13, -20];
        }
        throw new Error("Unknown rider family " + family);
    },

    setNumber: function(number) {
        let offsets = {
            1: 92,
            2: 83,
            3: 77
        };
        this.attach(Crafty.e("ParticipantNumber").setNumber(number).attr({x: offsets[number.toString().length], y: 129}));
        return this;
    },

    setHasBet: function() {
        this.attach(Crafty.e("BetMark").attr({x: 115, y: -45}));
        return this;
    },

    setAnimationSpeed: function(speed) {
        this._speed = speed;
        if (!this._getAnimatedChildren()[0].isPlaying()) {
            this._setupAnimation();
            this._animate();
        }
        return this;
    },

    _getAnimatedChildren: function() {
        let animated = [];
        for (let i = 0; i < this._children.length; i += 1) {
            let child = this._children[i];
            if (child.animate) {
                animated.push(child);
            }
        }
        return animated;
    },

    _setupAnimation: function() {
        let frames = this._getAnimationFrames();
        let animated = this._getAnimatedChildren();
        for (let i = 0; i < animated.length; i += 1) {
            animated[i].animate("common", frames);
        }
    },

    _getAnimationFrames: function() {
        let frames = [];
        for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
                frames.push([x, y]);
            }
        }
        return frames;
    },

    _animate: function() {
        let animate = $.proxy(function() {
            let animated = this._getAnimatedChildren();
            for (let i = 0; i < animated.length; i += 1) {
                animated[i].stop().animate("common", this._speed);
            }
        }, this);
        animate();
        this._getAnimatedChildren()[0].bind("AnimationEnd", animate);
    }
});
