/**
 * @file jet loader 依赖于 esl最新Master版本
 * @author kaivean(kaivean@outlook.com)
 */

(function (global) {

    /**
     * ESL的全局require
     * 不直接用全局变量，可变量压缩
     *
     * @type {Function}
     */
    var require = global.require;

    /**
     * 默认配置
     *
     * @inner
     * @type {Object}
     */
    var defaultOpt = {
        comboUrl: '/combo',
        map: {}
    };

    /**
     * 简单对象合并函数
     *
     * @inner
     * @return {Object} newObj
     */
    function extend() {
        var newObj = {};
        var obj;
        var key;
        var argsLen = arguments.length;
        for (var i = 0; i < argsLen; i++) {
            obj = arguments[i];
            for (key in obj) {
                if (obj.hasOwnProperty(key)) {
                    newObj[key] = obj[key];
                }
            }
        }
        return newObj;
    }

    /**
     * 简单数组去重函数
     *
     * @param {Array} arr 待去重数组
     * @return {Array} 新数组
     */
    function unique(arr) {
        var res = [];
        var map = {};
        var len = arr.length;
        for (var i = 0; i < len; i++) {
            if (!map[arr[i]]) {
                res.push(arr[i]);
                map[arr[i]] = 1;
            }
        }
        return res;
    }

    /**
     * 类JetLoader
     *
     * @class
     * @param {Object} opt 配置
     */
    function JetLoader(opt) {
        this.init(opt);
        this.cache = {};
    }

    JetLoader.prototype.init = function (opt) {
        this.opt = extend(defaultOpt, opt);
        this.map = this.opt.map;
        console.log('后端传递的ID映射关系：', this.map);
        this.register();
    };

    JetLoader.prototype.register = function () {
        var me = this;
        require.addLoader(function (context, callback) {
            return me.requireLoad(context, callback);
        });
    };

    JetLoader.prototype.buildUrl = function (paths) {
        var url = this.opt.comboUrl + '?';
        // 先做数组去重，因为可能多个模块对应一个js文件，会有重复js请求
        return url += 'js=' + encodeURIComponent(unique(paths).join(','));
    };

    JetLoader.prototype.loadDep = function (deps, context, callback) {
        var map = this.map;
        var len = deps.length;
        var paths = [];

        for (var i = 0; i < len; i++) {
            var id = deps[i];

            // 已经加载过了 或者 esl已经负责加载的
            if (this.cache[id] || context.getModuleState(id) !== require.ModuleState.NOT_FOUND) {
                continue;
            }
            var info = map[id];
            this.cache[id] = 1; // loading;
            paths.push(info.path);
        }
        console.log('Esl要加载模块', context.id, '，当前去请求Combo的模块有: ', paths.join(', '));
        context.load(this.buildUrl(paths));
    };

    JetLoader.prototype.requireLoad = function (context, callback) {
        console.log('esl要加载id：', context.id);

        var id = context.id;
        var map = this.map;
        if (!map[id]) { // map没有id，那么交给esl处理
            return true;
        }

        var deps;
        try {
            deps = this.analyze(id, map);

            this.loadDep(deps, context, callback);
        }
        catch (e) {
            console.log('analyze error', e);
            return true;
        }

        return false;
    };

    JetLoader.prototype.analyze = function (id, map) {
        var dep = [];
        var obj = map[id];
        var deps = obj.deps;
        var len = deps.length;

        for (var i = 0; i < len; i++) { // 继续深入分析依赖
            var nextid = deps[i];
            if (map[nextid]) { // 从map里找到模块依赖
                var d = this.analyze(deps[i], map);
                dep.push.apply(dep, d);
            }
        }

        dep.push(id);
        return dep;
    };

    JetLoader.prototype.destroy = function () {
        this.cache = this.map = this.opt = null;
    };

    global.JetLoader = JetLoader;
})(this);
