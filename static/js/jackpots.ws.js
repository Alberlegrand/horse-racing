jQuery(document).ready(function () {

    $("body").on("click", "#jackpot-toggler", function () {
        jQuery("#jackpots-panel").toggle();
    });

    $("body").on("click", ".js-jackpot-win-close", function () {
        jQuery(".js-jackpot-win-sum").text(0);
        jQuery("#jackpot-win-container").hide();
    });

    function updateSingleJackpot(element, jpData) {
        if (element) {
            if (jpData) {
                if (jpData.coming_soon) {
                    element.addClass("jackpot-coming-soon");
                }
                element.text(jpData.current);
                element.parent().show();
            } else {
                element.parent().hide();
            }
        }
    }

    function startJackpots(config) {
        if (!config) {
            console.warn("startJackpots: config is undefined");
            return;
        }
        if (typeof config.partnerId === "undefined" || config.partnerId === null) {
            console.warn("startJackpots: missing partnerId in config", config);
            return;
        }
        const partnerId = config.partnerId;

        if (!window.wsConfig) {
            throw new Error("wsConfig not defined");
        }

        const centrifuge = new Centrifuge(window.wsConfig.connectionString);
        centrifuge.setToken(window.wsConfig.token);

        centrifuge.on('connect', function (ctx) {
            jQuery("#jackpots-container").show();
        });

        centrifuge.on('disconnect', function (ctx) {
            jQuery("#jackpots-container").hide();
        });

        centrifuge.subscribe("public:" + partnerId + ":jackpots", function (ctx) {
            let jackpotsData = ctx.data;
            jQuery(".jackpot_item").hide();
            jQuery(".jackpot-coming-soon").removeClass("jackpot-coming-soon");
            if (jackpotsData && jackpotsData.jp_values && jackpotsData.jp_values[partnerId]) {
                let jpValues = jackpotsData.jp_values[partnerId];
                updateSingleJackpot(jQuery(".js-show-jp_1"), jpValues.jp_1);
                updateSingleJackpot(jQuery(".js-show-jp_2"), jpValues.jp_2);
                updateSingleJackpot(jQuery(".js-show-jp_3"), jpValues.jp_3);
            }
        });
        centrifuge.subscribe("user#" + window.wsConfig.userId, function (ctx) {
            let jackpotsData = ctx.data;
            if (jackpotsData.jp_win) {
                jQuery(".js-jackpot-win-sum").text(jackpotsData.jp_win);
                jQuery("#jackpot-win-container").css("display", "flex");
            }
        });

        centrifuge.connect();
    }

    startJackpots();
});