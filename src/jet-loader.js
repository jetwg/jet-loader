/**
 * @file jet loader 依赖于定制的 esl版本：给外部提供loader机制
 *       设计： 采用类中间件设计，目的是使得loader的依赖分析，优化、Combo加载等过程更近清楚有序，同时每个过程的异步操作也只是中间件内部控制即可，整个流程变得有序，也方便功能拓展和策略优化
 *       当前项目代码不多，就仿照大神一个文件到底了，后续将中间件拆成文件管理
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
        comboUrl: '/combo??', // combo url
        depUrl: '/dep?id=', // 动态获取依赖配置的url
        map: {} // 当前依赖配置
    };

    // 市面上对url的限制不一，也跟服务器设置相关，目前ie底版本限制2048，综合给出一个大概数字，后续根据线上稳定性日志调整
    var limitUrlLen = 2000; // 2000

    var loop = function () {};

    /**
     * 简单对象合并函数，返回新对象，不会修改参数对象
     *
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
     * 中间件包裹-实现加载优化，某个时间段 require的所有模块一次性加载
     *
     * @param {Object} ctx 实例上下文
     * @return {Function} 中间件
     */
    function collectModIds(ctx) {
        ctx.tmpCacheIds = [];

        return function (param, next) {
            // 缓冲区里没有模块id，那么就等待10ms后去加载模块id，同时10ms以内新增的id也一并一起执行
            if (!ctx.tmpCacheIds.length) {
                setTimeout(function () {
                    if (ctx.tmpCacheIds.length) {
                        ctx.ids = ctx.tmpCacheIds; // 将缓冲区所有模块压入主变量，开始加载这些模块模块
                        ctx.tmpCacheIds = [];  // 清空缓冲区，继续下一个tick的加载
                        next(); // 开始处理当前需要的模块
                    }
                }, 10);
            }
            else {
                next(false); // next 表示正常终止本次链式处理
            }
            ctx.tmpCacheIds.push(param);
        };
    }

    /**
     * Ajax请求简单封装
     *
     * @param {Object} ctx loader的实例对象
     * @param {Object} opt 参数
     * @param {string} opt.url 请求url
     * @param {Function} opt.success 请求成功回调
     * @param {Function} opt.error 请求失败回调
     * @return {undefined} 提前终止而已
     */
    function ajax(ctx, opt) {
        var xhr = ctx.xhr = new XMLHttpRequest();
        xhr.onload = function () {
            xhr.onload = null;
            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                }
                catch (e) {
                    opt.error('parse');
                    return;
                }
                opt.success(response);
            }
            else {
                // 响应返回的xhr.statusCode是4xx时，
                // 并不属于Network error，所以不会
                // 触发onerror事件，而是会触发onload事件。
                opt.error(false);
            }
        };
        // 由请求开始即onloadstart开始算起，
        // 当到达xhr.timeout所设置时间请求
        // 还未结束即onloadend，则触发此事件
        xhr.ontimeout = function () {
            opt.error('timeout');
        };
        // 只有发生了网络层级别的异常才会触发此事件
        xhr.onerror = function () {
            opt.error('error');
        };
        // 调用xhr.abort()后触发
        xhr.onabort = function () {
            opt.error('abort');
        };
        xhr.timeout = 10000;
        xhr.open('get', opt.url, true);
        xhr.send();
    }

    /**
     * 动态加载缺失模块依赖
     *
     * @param {Object} ctx loader的实例对象
     * @param {Array} lackIds 缺失的模块
     * @param {Function} callback 回调
     * @return {undefined} 提前终止而已
     */
    function loadLackedIdMap(ctx, lackIds, callback) {
        if (!lackIds.length) {
            return callback(true);
        }
        var url = ctx.opt.depUrl + encodeURIComponent(lackIds.join(','));
        ajax(ctx, {
            url: url,
            success: function (res) {
                if (res.status) {
                    return callback(false);
                }

                ctx.map = extend(ctx.map, res.data);
                // 自己使用，不用判断callback是否存在
                callback(true);
            },
            error: function () {
                callback(false);
            }
        });
    }

    /**
     * 中间件包裹-获取到本次加载模块的所有依赖是否已经ready，没有ready就去下载
     *
     * @param {Object} ctx 实例上下文
     * @return {Function} 中间件
     */
    function getDepMap(ctx) {

        return function (param, next) {
            var len = ctx.ids.length;
            var lackIds = [];

            for (var i = 0; i < len; i++) { // 继续深入分析依赖v
                var id = ctx.ids[i];
                if (!ctx.map[id]) {
                    lackIds.push(id);
                }
            }

            loadLackedIdMap(ctx, lackIds, function (res) {
                next(res);
            });
        };
    }

    /**
     * 递归分析依赖
     *
     * @param {string} id 模块id
     * @param {Object} map 依赖映射关系
     * @return {Function} 中间件
     */
    function analyze(id, map) {
        var dep = [];
        var info = map[id];
        var deps = info.d || []; // d代表直接依赖，用简写减少输出到html代码量
        var len = deps.length;

        for (var i = 0; i < len; i++) { // 继续深入分析依赖
            var nextid = deps[i];
            if (map[nextid]) { // 从map里找到模块依赖
                var d = analyze(deps[i], map);
                dep.push.apply(dep, d);
            }
        }

        dep.push(id);
        return dep;
    }

    /**
     * 中间件包裹-分析模块的所有依赖模块
     *
     * @param {Object} ctx 实例上下文
     * @return {Function} 中间件
     */
    function analyzeDep(ctx) {
        ctx.deps = [];

        return function (param, next) {
            var dep = [];
            var map = ctx.map;
            var len = ctx.ids.length;
            for (var i = 0; i < len; i++) { // 继续深入分析依赖
                var id = ctx.ids[i];
                if (map[id]) { // 从map里找到模块依赖
                    var d = analyze(id, map);
                    dep.push.apply(dep, d);
                }
            }
            ctx.deps = dep;
            next();
        };
    }

    /**
     * 中间件包裹-以combo服务加载所有依赖模块
     *
     * @param {Object} ctx 实例上下文
     * @return {Function} 中间件
     */
    function combo(ctx) {
        // 必须调用esl的 loadModule 加载模块， 否则esl无法保证得知id的加载状态，会导致超时
        function loadUrl(path, ids) {
            var url = ctx.opt.comboUrl + path;
            var elsContext = ctx.eslContext;
            var len = ids.length;
            for (var i = 0; i < len; i++) {
                var id = ids[i];
                if (!(elsContext.loadingModules[id] || elsContext.modModules[id])) {
                    elsContext.loadModule(id, url);
                }
            }
        }

        // 优化：当要combo加载的模块过多，那么url可能长，过长容易导致url加载失败，因此做截断处理，分段加载
        function load(ids) {
            var len = ids.length;
            var param = '';
            var paramLimit = limitUrlLen - ctx.opt.comboUrl.length; // 去除
            var curIds = [];
            var comma = ','; // encodeURIComponent(',');
            for (var i = 0; i < len; i++) {
                var id = ids[i]; // encodeURIComponent(ids[i]);
                var gap = param ? comma : '';
                var nextparam = param + gap + id;
                if (nextparam.length > paramLimit) {
                    loadUrl(param, curIds); // 加载当前url
                    param = ''; // 清空query
                    param += id;
                    curIds = []; // 清空已经开始加载的id
                    curIds.push(id);
                }
                else {
                    curIds.push(id);
                    param = nextparam;
                }

                if (i === len - 1) {
                    loadUrl(param, curIds);
                }
            }
        }

        function loadDep(callback) {
            var deps = ctx.deps;
            var map = ctx.map;
            var len = deps.length;
            var paths = [];
            for (var i = 0; i < len; i++) {
                var id = deps[i];

                // 已经加载过了 或者 esl已经负责加载的
                if (ctx.cache[id] || ctx.eslContext.getModuleState(id) !== require.ModuleState.NOT_FOUND) {
                    continue;
                }
                var info = map[id];
                var path = info.p || id;
                ctx.cache[id] = 1; // loading;
                paths.push(path);
            }
            paths = unique(paths);
            load(paths); // 加载模块，处理url过长情况，同时交给esl的去加载
            callback();
        }

        return function (param, next) {
            loadDep(function () {
                next();
            });
        };
    }

    /**
     * 实现链式调用，为了支持在每个回调函数里可能存在异步操作，因此不能简单同步执行所有fns，而是等到回调的异步完成后，在执行下一个回调，保证操作的可控性
     *
     * @param {Array} fns 所有中间件
     * @param {number} index 当前调用第几个中间件
     * @param {Object} args 参数
     * @param {Function} callback 链式调用完成后的回调
     * @return {Mixed} 返回值
     */
    function chains(fns, index, args, callback) {
        args = args || [];
        var context = this;

        // status: 空，{status: 0} 代表 正常，继续
        // status: false 或者 {status: 1} 代表正常，停止
        // status: 对象 {status: 2} ，代表出错，此时需要做兜底方案
        var next = function (param) {
            next = loop;
            var ret = {status: 2};
            if (typeof param === 'undefined' || param === true) { // next() 快捷用法
                ret.status = 0;
            }
            if (param === false) { // next(false) 快捷用法
                ret.status = 1;
            }
            if (typeof param === 'object') {
                ret = param;
            }

            // 还有中间件要执行, 且 本次中间件没要求退出链式调用
            if (index < fns.length - 1 && !ret.status) {
                args.pop();
                chains.call(context, fns, ++index, args, callback);
            }
            else {
                callback(ret);
            }
        };
        args.push(next);
        var ret = fns[index].apply(context, args);
        // 如果没有返回false，那么就主动执行下一个回调
        if (ret) {
            next();
        }
        ret && next();

        // 如果没有处理，那么就是false，就是该模块由我们加载，esl不需要管了，必须返回false才行，undefine不行
        return typeof ret === 'undefined' ? false : ret;
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
        this.middlewares = [];
    }

    /**
     * 初始化loader，并处理外部传入参数
     *
     * @param {Object} opt 参数
     */
    JetLoader.prototype.init = function (opt) {
        opt = opt || {};
        this.opt = extend(defaultOpt, opt);
        this.map = this.opt.map;
    };

    /**
     * 执行loader，监听模块加载
     *
     */
    JetLoader.prototype.run = function () {
        this.registerLoader();

        this.use(collectModIds(this));
        this.use(getDepMap(this));
        this.use(analyzeDep(this));
        this.use(combo(this));
    };

    /**
     * 注册esl的loader，用于监听模块加载
     */
    JetLoader.prototype.registerLoader = function () {
        var me = this;
        require.addLoader(function (context, callback) {
            return me.requireLoad(context, callback);
        });
    };

    /**
     * 安装中间件
     *
     * @param {Function} fn 中间件
     */
    JetLoader.prototype.use = function (fn) {
        this.middlewares.push(fn);
    };

    /**
     * esl要加载模块的回调，通知我们
     *
     * @param {Object} context 参数，包含 要加载的id
     * @param {Function} callback 链式调用完成后的回调
     * @return {Mixed} 返回值
     */
    JetLoader.prototype.requireLoad = function (context, callback) {
        // 以数组传递，方便后续可以应用apply函数
        var args = [{
            id: context.id // 当前只有一个id，后续可能会增加参数，那么每个中间件都有参数param = {id: };
        }];
        // 保存起来，后续会用到来调用esl的loadModule来加载模块
        this.eslContext = context;
        var ret = chains.call(this, this.middlewares, 0, args, function (ret) {
            callback(); // 告诉esl完成加载
        });
        return ret;
    };

    /**
     * 自毁，清空缓存
     *
     * @param {string} event 事件名
     */
    JetLoader.prototype.destroy = function () {
        this.cache = this.map = this.opt = this.middlewares = null;
    };

    // todo: 暂时先暴露全局变量
    global.JetLoader = JetLoader;
})(this);
