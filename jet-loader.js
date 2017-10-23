/**
 * @file jet loader 依赖于定制的 esl版本：给外部提供loader机制
 *       设计： 采用类中间件设计，目的是使得loader的依赖分析，优化、Combo加载等过程更近清楚有序，
 *             同时每个过程的异步操作也只是中间件内部控制即可，整个流程变得有序，也方便功能拓展和策略优化
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
     * @type {Object}
     */
    var defaultOpt = {
        comboHost: location.protocol === 'https:' ? 'https://ss3.bdstatic.com/7r1SsjikBxIFlNKl8IuM_a' : 'http://jet.bdstatic.com', // combo url, cdn
        comboPath: '/bypath??', // combo url, cdn
        nginxComboPath: '/combo/jetdist??', // 普通nginx combo，用来做兜底
        depUrl: '//jet.baidu.com/dep?ids=', // 动态获取依赖配置的url
        map: {}, // 当前依赖配置
        loadDep: true, // 没有依赖，就动态去加载依赖，默认true
        debug: false // debug为true，不做combo，bypath带上模块信息
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
     * 简单去重函数，去重模块，已模块id为唯一
     *
     * @param {Array} arr 待去重数组
     * @param {boolean} isItemObj 数组项是对象，还是 其他, 对象的化，根据id去重
     * @return {Array} 新数组
     */
    function unique(arr, isItemObj) {
        var res = [];
        var map = {};
        var len = arr.length;
        for (var i = 0; i < len; i++) {
            var key = isItemObj ? arr[i].id : arr[i];
            if (!map[key]) {
                res.push(arr[i]);
                map[key] = 1;
            }
        }
        return res;
    }

    function each(obj, cb) {
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                cb(obj[key], key);
            }
        }
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
        // disableLoadDeps是在分析时标记的当前缺失某些模块信息，需要走兜底机制，不用再请求了
        if (!lackIds.length || ctx.instance.disableLoadDeps) {
            return callback(true);
        }
        lackIds = unique(lackIds);
        var instance = ctx.instance;
        var url = instance.opt.depUrl + encodeURIComponent(lackIds.join(','));
        ajax(ctx, {
            url: url,
            success: function (res) {
                if (res.status) {
                    return callback(false);
                }
                instance.addMap(res.data);
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
     * @param {Object} instance 实例上下文
     * @return {Function} 中间件
     */
    function getDepMap(instance) {
        var map = instance.map;

        function findIdFromMap(id) {
            for (var packName in map) {
                if (map.hasOwnProperty(packName)) {
                    if (map[packName].map[id]) {
                        return true;
                    }
                }
            }
            return false;
        }

        return function (ctx, next) {
            var len = ctx.ids.length;
            var lackIds = [];

            for (var i = 0; i < len; i++) { // 继续深入分析依赖v
                var id = ctx.ids[i];
                if (!findIdFromMap(id)) {
                    lackIds.push(id);
                }
            }
            loadLackedIdMap(ctx, lackIds, function (res) {
                next(res);
            });
        };
    }

    function findId(id, packName, map) {
        var sections = id.split('/');
        var modInfo;
        if (packName) {
            var packInfo = map[packName];
            modInfo = packInfo.map[id];
            if (modInfo) {
                return {
                    modInfo: modInfo,
                    packName: packName
                };
            }
        }

        var idPackName = sections[0]; // 从Id解析出该id的包名，取到该报名
        var idPackInfo = map[idPackName]; // 从
        if (!idPackInfo) { // id包的包映射都没有
            return {
                modInfo: modInfo,
                packName: packName || idPackName  // 还是返回原来的pack，而不是id的pack
            };
        }

        modInfo = idPackInfo.map[id];
        if (modInfo) { // id包里有，就返回
            return {
                modInfo: modInfo,
                packName: idPackName
            };
        }
        console.warn('lack module info', id, packName);
        // 最终就是没找到
        return {
            modInfo: modInfo,
            packName: packName || idPackName // 还是返回原来的pack，而不是id的pack
        };
    }

    function existId(id, outModDeps) {
        for (var i = 0; i < outModDeps.length; i++) {
            if (outModDeps[i].id === id) {
                return true;
            }
        }
        return false;
    }

    /**
     * 递归分析依赖
     *
     * @param {string} id 模块id
     * @param {Object} packName 依赖映射关系
     * @param {Object} map 依赖映射关系
     * @param {Object} outModDeps 依赖映射关系
     * @return {Function} 中间件
     */
    function analyze(id, packName, map, outModDeps) {
        var res = findId(id, packName, map);
        packName = res.packName;
        var modInfo = res.modInfo || {};
        var depMods = [];
        var modDeps = modInfo.d || []; // d代表直接依赖，用简写减少输出到html
        var len = modDeps.length;
        for (var i = 0; i < len; i++) { // 继续深入分析依赖
            var nextid = modDeps[i];
            if (!existId(nextid, outModDeps)) { // 从map里找到模块依赖
                var mods = analyze(nextid, packName, map, outModDeps);
                depMods.push.apply(depMods, mods);
            }
        }
        modInfo.id = id;
        depMods.push(modInfo);
        return depMods;
    }

    /**
     * 中间件包裹-分析模块的所有依赖模块
     *
     * @param {Object} instance 实例上下文
     * @return {Function} 中间件
     */
    function analyzeDep(instance) {
        instance.lackDeps = [];
        return function (ctx, next) {

            var outModDeps = [];
            var map = instance.map;
            var ids = ctx.ids;
            var len = ids.length;
            for (var i = 0; i < len; i++) { // 继续深入分析依赖
                var id = ids[i];
                if (!existId(id, outModDeps)) { // 从map里找到模块依赖
                    var d = analyze(id, null, map, outModDeps);
                    outModDeps.push.apply(outModDeps, d);
                }
                // else {
                //     instance.lackDeps.push(id);
                //     console.warn('lack id', id);
                //     outModDeps.push(id); // 没有依赖关系还是要去尝试加载的
                // }
            }
            ctx.deps = outModDeps;
            next();
        };
    }

    // 怕不同id，指向同一个文件，所以做了层unique，相同path只combo加载一次
    var pathCache = {};


    var headElement = document.getElementsByTagName('head')[0];
    var baseElement = document.getElementsByTagName('base')[0];
    if (baseElement) {
        headElement = baseElement.parentNode;
    }
    var loadingURLs = {};

    function createScript(src, onload) {
        if (loadingURLs[src]) {
            return;
        }

        loadingURLs[src] = 1;

        // 创建script标签
        //
        // 这里不挂接onerror的错误处理
        // 因为高级浏览器在devtool的console面板会报错
        // 再throw一个Error多此一举了
        var script = document.createElement('script');
        script.setAttribute('data-src', src);
        script.src = src;
        script.async = true;
        if (script.readyState) {
            script.onreadystatechange = innerOnload;
        }
        else {
            script.onload = innerOnload;
        }

        function innerOnload() {
            var readyState = script.readyState;
            if (
                typeof readyState === 'undefined'
                || /^(loaded|complete)$/.test(readyState)
            ) {
                script.onload = script.onreadystatechange = null;
                script = null;

                onload();
            }
        }
        // currentlyAddingScript = script;

        // If BASE tag is in play, using appendChild is a problem for IE6.
        // See: http://dev.jquery.com/ticket/2709
        baseElement
            ? headElement.insertBefore(script, baseElement)
            : headElement.appendChild(script);
    }

    function getNowFormatDate() {
        var date = new Date();
        var seperator1 = '';
        var seperator2 = '';
        var month = date.getMonth() + 1;
        var strDate = date.getDate();
        if (month >= 1 && month <= 9) {
            month = '0' + month;
        }
        if (strDate >= 0 && strDate <= 9) {
            strDate = '0' + strDate;
        }
        var currentdate = date.getFullYear() + seperator1 + month + seperator1 + strDate
                + '' + date.getHours() + seperator2 + date.getMinutes();
                // + seperator2 + date.getSeconds();
        return currentdate;
    }

    /**
     * 兜底加载，通过id去加载，不缓存
     *
     * @param {Object} ctx loader实例
     * @param {string} id url的search
     */
    function loadUrlByid(ctx, id) {
        var url = ctx.instance.nginxComboUrl + id + '.js,' + getNowFormatDate();

        createScript(url, function () {
            ctx.modAutoDefine();
        });
        // var eslContext = ctx.eslContext;
        // var len = ids.length;
        // for (var i = 0; i < len; i++) {
        //     var id = ids[i];
        //     if (!(eslContext.loadingModules[id] || eslContext.modModules[id])) {
        //         eslContext.loadModule(id, url);
        //     }
        // }
    }

    /**
     * 必须调用esl的 loadModule 加载模块， 否则esl无法保证得知id的加载状态，会导致超时
     *
     * @param {Object} ctx loader实例
     * @param {string} search url的search
     * @param {Array} ids 所有模块
     */
    function loadUrl(ctx, search, ids) {

        if (ctx.instance.opt.debug) {
            var idStr = '_db_' + ids.join('|');
            search = idStr + ',' + search;
        }

        var url = ctx.instance.comboUrl + search;

        createScript(url, function () {
            ctx.modAutoDefine();
        });
        // var eslContext = ctx.eslContext;
        // var len = ids.length;
        // for (var i = 0; i < len; i++) {
        //     var id = ids[i];
        //     if (!(eslContext.loadingModules[id] || eslContext.modModules[id])) {
        //         eslContext.loadModule(id, url);
        //     }
        // }
    }

    /**
     * 加载所有模块，优化：当要combo加载的模块过多，那么url可能长，过长容易导致url加载失败，因此做截断处理，分段加载
     *
     * @param {Object} ctx loader实例
     * @param {Array} modInfos 所有模块
     */
    function load(ctx, modInfos) {
        var len = modInfos.length;
        var search = ''; // url的search部分
        var searchLimit = limitUrlLen - ctx.instance.comboUrl.length; // 去除
        var curIds = [];
        var comma = ','; // encodeURIComponent(',');
        for (var i = 0; i < len; i++) {
            var modInfo = modInfos[i]; // encodeURIComponent(ids[i]);
            var id = modInfo.id;
            var gap = search ? comma : '';
            if (!modInfo.p) { // 模块路径不存在，就是模块信息为空, 走id路径加载
                loadUrlByid(ctx, id, curIds);
                pathCache[id] = 1;

                ctx.instance.disableLoadDeps = true; // 不再动态请求deps，因为缺乏依赖，可能nodejs挂了，再请求也没用

                if (curIds.length) { // 如果还有一些id没有加载，那么先去加载
                    loadUrl(ctx, search, curIds); // 加载当前url
                    search = ''; // 清空query
                    curIds = []; // 清空已经开始加载的id
                }
                continue;
            }

            var path = modInfo.p;
            var nextsearch = search;
            // 怕不同id，指向同一个文件，所以做了层unique，相同path只combo加载一次
            if (pathCache[path]) {
                curIds.push(id);
                continue;
            }
            nextsearch = search + gap + path;
            pathCache[path] = 1;
            if (nextsearch.length > searchLimit) {
                loadUrl(ctx, search, curIds); // 加载当前url
                search = path; // 清空query
                curIds = []; // 清空已经开始加载的id
                curIds.push(id);
            }
            else {
                curIds.push(id);
                search = nextsearch;
            }

            // 最后了，必须要加载了
            if (i === len - 1) {
                loadUrl(ctx, search, curIds);
            }
        }
    }

    /**
     * 中间件包裹-以combo服务加载所有依赖模块
     * 说明： 中间件返回一个函数，而不是直接函数，目的是use中间件时，可以做一些初始化工作，以下没有这些工作
     *
     * @param {Object} instance 实例上下文
     * @return {Function} 中间件
     */
    function combo(instance) {

        return function (ctx, next) {
            var deps = ctx.deps;
            var len = deps.length;
            var modInfos = [];
            for (var i = 0; i < len; i++) {
                var modInfo = deps[i];
                var id = modInfo.id;
                // 已经加载过了 或者 esl已经负责加载的
                if (instance.cache[id] || ctx.eslContext.getModuleState(id) !== require.ModuleState.NOT_FOUND) {
                    continue;
                }
                instance.cache[id] = 1; // loading;

                // 不要combo，就一个一个加载
                if (instance.opt.debug) {
                    load(ctx, [modInfo]);
                }
                else {
                    modInfos.push(modInfo);
                }
            }
            // 需要debug的话
            if (!instance.opt.debug) {
                modInfos = unique(modInfos, true); // 对象数组去重，根据id
                load(ctx, modInfos); // 加载模块，处理url过长情况，同时交给esl的去加载
            }

            next();
        };
    }

    /**
     * 实现链式调用，为了支持在每个回调函数里可能存在异步操作，因此不能简单同步执行所有fns，而是等到回调的异步完成后，在执行下一个回调，保证操作的可控性
     *
     * @param {Array} fns 所有中间件
     * @param {number} index 当前调用第几个中间件
     * @param {Object} context 参数
     * @param {Function} callback 链式调用完成后的回调
     * @return {Mixed} 返回值
     */
    function chains(fns, index, context, callback) {
        context = context || [];
        var instance = this;

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
                context.pop();
                chains.call(instance, fns, ++index, context, callback);
            }
            else {
                callback(ret);
            }
        };
        context.push(next);
        var ret = fns[index].apply(instance, context);
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
        this.tmpCacheIds = [];
    }

    /**
     * 初始化loader，并处理外部传入参数
     *
     * @param {Object} opt 参数
     */
    JetLoader.prototype.init = function (opt) {
        opt = opt || {};
        this.opt = extend(defaultOpt, opt);
        this.comboUrl = this.opt.comboHost + this.opt.comboPath;
        this.nginxComboUrl = this.opt.comboHost + this.opt.nginxComboPath;
        this.map = this.opt.map;
    };

    /**
     * 执行loader，监听模块加载
     *
     */
    JetLoader.prototype.run = function () {
        this.registerLoader();

        if (this.opt.loadDep) {
            this.use(getDepMap(this));
        }
        this.use(analyzeDep(this));
        this.use(combo(this));
    };

    /**
     * 注册esl的loader，用于监听模块加载
     */
    JetLoader.prototype.registerLoader = function () {
        var me = this;
        require.addLoader(function (context, modAutoDefine) {
            return me.requireLoad(context, modAutoDefine);
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
     * 增加映射
     *
     * @param {Function} fn 中间件
     */
    JetLoader.prototype.addMap = function (newmap) {
        let self = this;
        if (newmap.constructor.name !== 'Object') {
            return;
        }
        each(newmap, function (packInfo, packName) {
            var curPackInfo = self.map[packName];
            if (!curPackInfo) {
                curPackInfo = {map: {}};
            }
            curPackInfo.map = extend(curPackInfo.map, packInfo.map || {});
            self.map[packName] = curPackInfo;
        });
    };

    /**
     * esl要加载模块的回调，通知我们
     *
     * @param {Object} eslContext 参数，包含 要加载的id
     * @param {Function} modAutoDefine 链式调用完成后的回调
     * @return {Mixed} 返回值
     */
    JetLoader.prototype.requireLoad = function (eslContext, modAutoDefine) {
        var me = this;
        var tmpCacheIds = me.tmpCacheIds;

        // 缓冲区里没有模块id，那么就等待2ms后去加载模块id，同时2ms以内新增的id也一并一起执行
        if (!tmpCacheIds.length) {
            setTimeout(function () {
                if (me.tmpCacheIds.length) {
                    // 以数组传递，方便后续可以应用apply函数
                    var context = [{
                        instance: me,
                        eslContext: eslContext, // 保存起来，后续会用到来调用esl的loadModule来加载模块
                        modAutoDefine: modAutoDefine,
                        ids: me.tmpCacheIds // 将缓冲区所有模块压入主变量，开始加载这些模块模块
                    }];

                    me.tmpCacheIds = []; // 清空缓冲区，继续下一个tick的加载
                    chains.call(me, me.middlewares, 0, context, function (ret) {
                        modAutoDefine(); // 告诉esl完成加载
                    });
                }
            }, 2);
        }

        tmpCacheIds.push(eslContext.id);
        return false;
    };

    /**
     * 自毁，清空缓存
     *
     * @param {string} event 事件名
     */
    JetLoader.prototype.destroy = function () {
        this.cache = this.map = this.opt = this.middlewares = null;
        this.requireLoad = function (context) {
            return; // 不接管了， 接管需要  返回false
            // return false; // 接管， 自己加载
            // return id; // 更改模块id，不会走baseUrl了， 还是esl加载
        };
    };

    var singleton = null;
    JetLoader.start = function (conf) {
        console.log('addmap', conf.map)
        if (!singleton) {
            singleton = new JetLoader(conf);
            singleton.run();
        }
        else {
            singleton.addMap(conf.map);
        }

        return singleton;
    };
    JetLoader.stop = function (conf) {
        if (singleton) {
            singleton.destroy();
            singleton = null;
        }
    };

    if (typeof define === 'function' && define.amd) {
        define(function () {
            return JetLoader;
        });
    }

    // todo: 暂时先暴露全局变量
    global.JetLoader = JetLoader;
})(this);
