let Server = function (onStartRequest, onFinishRequest, onError, onRequireAuth) {
    this._onStartRequest = onStartRequest;
    this._onFinishRequest = onFinishRequest;
    this._onError = onError;
    this._onRequireAuth = onRequireAuth;
};

Server.prototype.request = function (method, data, callback) {
    this._onStartRequest();
    $.ajax({
        type: "POST",
        url: "/api/v1/" + method,
        contentType: "application/json",
        data: JSON.stringify(data),
        dataType: "json",
        timeout: 60000,
        async: true,
        success: $.proxy(function (response) {
            this._onFinishRequest();
            if (response && response.data) {
                callback(response.data);
            }
        }, this),
        error: $.proxy(function (response, responseStatus) {
            this._onFinishRequest();
            if (response.status !== 403) {
                this._onError(response, responseStatus);
            }
        }, this),
        statusCode: {
            403: this._onRequireAuth
        }
    });
};
