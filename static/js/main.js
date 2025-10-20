
        let Messages = {
            TITLE: "Round N $id",
            MONEY_AMOUNT: "$value HTG",
            PAYOUT: "Payment",
            TOTAL: "Total",
            WINNER: "Winner of the round № $id",
            BET_TOO_SMALL: "The minimum bet is $value. Make one more bet.",
            BET_TOO_BIG: "The maximum bet is $value. Make a smaller bet.",
            NO_BETS: "Bets are not defined.",
            NO_RECEIPTS: "No receipts.",
            AJAX_TIMEOUT: "Failed to send request. Please check your internet connection",
        };

        let client = new WebClient();
        let minBet = 1000;
        let maxBet = 500000;
        let showDecimal = false;
       // Configuration pour la connexion WebSocket
window.wsConfig = {
    connectionString: "ws://localhost:8081/connection/websocket",
    token: "LOCAL_TEST_TOKEN",
    userId: "local.6130290",
    partnerId: "platform_horses"
};

// Configuration spécifique au jeu, y compris l'impression
window.gameConfig = {
    enableReceiptPrinting: true ,
    receiptUrl: "/api/v1/receipts",
    assetPath: "/img/",
    // ... potentiellement d'autres paramètres de jeu ...
};

        if (showDecimal) Currency.changeDigits({ digits: 2, visibleDigits: 2 });
        else Currency.changeDigits({ digits: 2, visibleDigits: 0 });

        client.init(
            {
                assetPath: "/img/",
                receiptUrl: "/api/v1/receipts",
                limits: new LimitModel(new Big(minBet), new Big(maxBet)),
                keepAliveUrl: "/api/v1/keepalive/",
                keepAliveTick: "20000",
                keepAliveTimeout: "5000"
            },
            Messages
        )
        window.wsConfig = {
            enableReceiptPrinting: "true",
            connectionString: "ws://localhost:8081/connection/websocket",
            token: "LOCAL_TEST_TOKEN",
            userId: "local.6130290",
            partnerId: "platform_horses"
        };