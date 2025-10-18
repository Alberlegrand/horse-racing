class Currency {
    /**
     * @type {number}
     * @description system ↔ public transformation\
     *      `digits = 2` means `public [5] = system [500]`;\
     *      `digits: -2`: `public [5] = system [0.05]`
     */
    static digits = 0;
    /**
     * @type {number}
     * @description public visibility:\
     *      `visibleDigits = 0` means `public [5] = system [5.12]`;\
     *      `visibleDigits = 2` means `public [5.12] = system [5.12]`
     */
    static visibleDigits = 0;
    /** @type {(config: {digits: number; visibleDigits: number}) => void} */
    static changeDigits = ({digits, visibleDigits}) => {
        this.digits = Math.max(0, digits);
        this.visibleDigits = visibleDigits;
    }
    /**
     * @param [digits] {number}
     * @returns {number}
     */
    static multiply = (digits) => {
        return Math.pow(10, digits || this.digits);
    }
    /**
     * @type {((value: number, digits?: number) => number) | ((value: Big, digits?: number) => Big)}
     */
    static systemToPublic = (value, digits) => {
        if (value instanceof Big) return value.times(1 / this.multiply(digits));
        return value / this.multiply(digits);
    }
    /**
     * @type {((value: number, digits?: number) => number) | ((value: Big, digits?: number) => Big)}
     */
    static publicToSystem = (value, digits) => {
        if (value instanceof Big) return value.times(this.multiply(digits));
        return value * this.multiply(digits);
    }
}
