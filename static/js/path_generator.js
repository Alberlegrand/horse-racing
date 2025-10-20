let Point = function(offset, time, velocity, accel, duration) {
    this.offset = offset;
    this.time = time;
    this.velocity = velocity;
    this.accel = accel;
    this.duration = duration;
};

let Path = function() {};
Path.prototype = [];

Path.prototype.isLongerThan = function(offset) {
    return this[this.length - 1].offset > offset;
};

Path.prototype._getPointByTime = function(time) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
        let point = this[i];
        if (point.time <= time) {
            return point;
        }
    }
    return null;
};

Path.prototype.getOffset = function(time) {
    let point = this._getPointByTime(time);
    let delta = time - point.time;
    return point.offset + delta * point.velocity + (point.accel * delta * delta) / 2;
};

Path.prototype.getAccel = function(time) {
    let point = this._getPointByTime(time);
    return point.accel;
};

Path.prototype._getPointByOffset = function(offset) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
        let point = this[i];
        if (point.offset <= offset) {
            return point;
        }
    }
    return null;
};

Path.prototype.getTime = function(offset) {
    let point = this._getPointByOffset(offset);
    let delta = offset - point.offset;
    if (point.accel === 0) {
        return point.time + delta / point.velocity;
    } else {
        return point.time + ((Math.sqrt(Math.pow(point.velocity, 2) + 2 * point.accel * delta)) - point.velocity) / point.accel;
    }
};

let PathGenerator = function() {};

PathGenerator.SPEED = 600;
PathGenerator.RELATIVE_SPEED = 0;
PathGenerator.MAX_RELATIVE_SPEED = 40;
PathGenerator.START_ACCEL_TIME = 1;
PathGenerator.START_ACCEL_DISTANCE = 0.02;
PathGenerator.ACCEL = 80;
PathGenerator.ACCEL_TIME = (PathGenerator.MAX_RELATIVE_SPEED - PathGenerator.RELATIVE_SPEED) / PathGenerator.ACCEL;
PathGenerator.MAX_FINISH_ACCEL = 60;
PathGenerator.POSITION_DISTANCE = 60;
PathGenerator.POSITION_COUNT = 10;
PathGenerator.MAX_POSITION_CHANGE = 2;

PathGenerator.prototype._addPoint = function(path, accel, duration) {
    let next;
    if (!path.length) {
        next = new Point(GameParams.START_OFFSET, 0, 0, accel, duration);
    } else {
        let prev = path[path.length - 1];
        let offset = prev.offset + prev.velocity * prev.duration + (prev.accel * prev.duration * prev.duration) / 2;
        let velocity = prev.velocity + prev.accel * prev.duration;
        let time = prev.time + prev.duration;
        next = new Point(offset, time, velocity, accel, duration);
    }
    path.push(next);
};

PathGenerator.prototype._removeLastPoints = function(path, count) {
    path.splice(path.length - count);
};

PathGenerator.prototype._addStartAccelerationPoints = function(path) {
    let accel = PathGenerator.SPEED / PathGenerator.START_ACCEL_TIME;
    this._addPoint(path, accel, PathGenerator.START_ACCEL_TIME);
    return PathGenerator.POSITION_COUNT / 2;
};

PathGenerator.prototype._getNextPosition = function(current) {
    let next;
    while (true) {
        next = Math.floor(Math.random() * PathGenerator.POSITION_COUNT);
        if (Math.abs(next - current) > PathGenerator.MAX_POSITION_CHANGE) {
            continue;
        }
        if (next !== current) {
            break;
        }
    }
    return next;
};

PathGenerator.prototype._addSwapPoints = function(path, current) {
    while (true) {
        let next = this._getNextPosition(current);
        this._addPoint(path, next > current ? PathGenerator.ACCEL : -PathGenerator.ACCEL, PathGenerator.ACCEL_TIME);
        let distance = Math.abs(next - current) * PathGenerator.POSITION_DISTANCE - PathGenerator.ACCEL * Math.pow(PathGenerator.ACCEL_TIME, 2);
        this._addPoint(path, 0, distance / PathGenerator.MAX_RELATIVE_SPEED);
        this._addPoint(path, next > current ? -PathGenerator.ACCEL : PathGenerator.ACCEL, PathGenerator.ACCEL_TIME);
        if (path.isLongerThan((1 - PathGenerator.START_ACCEL_DISTANCE) * GameParams.TRACK_LENGTH)) {
            this._removeLastPoints(path, 3);
            break;
        }
        current = next;
    }
};

PathGenerator.prototype._addFinalPoint = function(path) {
    this._addPoint(path, 0, 1e9);
};

PathGenerator.prototype._generate = function() {
    let path = new Path();
    let current = this._addStartAccelerationPoints(path);
    this._addSwapPoints(path, current);
    this._addFinalPoint(path);
    return path;
};

PathGenerator.prototype.generateAll = function(count) {
    let paths = [];
    for (let i = 0; i < count; i += 1) {
        paths.push(this._generate());
    }
    return paths;
};

PathGenerator.prototype.setFastOnFinish = function(path) {
    this._removeLastPoints(path, 1);
    this._addPoint(path, PathGenerator.MAX_FINISH_ACCEL, 1e9);
};
