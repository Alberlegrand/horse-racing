let UserManager = function () {
    this._money = null;
};

UserManager.prototype.setMoney = function (money) {
    this._money = new Big(money);
};

UserManager.prototype.getMoney = function () {
    return this._money;
};
