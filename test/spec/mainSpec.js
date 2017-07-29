/* eslint-disable */

// 改变combo url到 karam的服务器mock的js文件
// 判断浏览器是否支持该元素
let constructor = document.createElement('script').constructor.prototype;
let srcMap = {
    '/combo??zhaopin/home/index.12.js,fusion/util.20.js,fusion/tab/index.66.js': 'index-util-tab.js',
    '/combo??fusion/popup/index.77.js,zhaopin/home/async.99.js': 'popup-async.js'
};
// 监听src属性的变化
Object.defineProperty(constructor, 'src', {
    set(value) {
        if (srcMap[value]) {
            value = '/base/test/combo/' + srcMap[value];
        }
        this.setAttribute('src', value);
    }
});

// 重置esl。才能继续测试，否则模块都是已经定义好的
function resetEsl(done) {
    window.require = undefined;
    window.define = undefined;
    window.esl = undefined;

    var headElement = document.getElementsByTagName('head')[0];

    function loadEsl(cb) {
        var script = document.createElement('script');
        script.src = '/base/test/esl.js';
        headElement.appendChild(script);
        if (script.readyState) {
            script.onreadystatechange = function () {
                cb();
            };
        }
        else {
            script.onload = function () {
                cb();
            };
        }
    }

    function loadJet(cb) {
        var script = document.createElement('script');
        script.src = '/base/src/jet-loader.js';
        headElement.appendChild(script);
        if (script.readyState) {
            script.onreadystatechange = function () {
                cb();
            };
        }
        else {
            script.onload = function () {
                cb();
            };
        }
    }

    loadEsl(function () {
        loadJet(function () {
            done();
        });
    });

}

describe('jet-loader测试一', function() {
    beforeEach(function() {
    });

    afterEach(function () {
    });

    it('通常情况下，jet-loader加载模块执行', function (done) {
        // 模块的依赖映射关系
        var jetOpt = {
            map: {
                "fusion/util": {
                    "p": "fusion/util.20.js",
                    "d": [],
                    "a": []
                },
                "fusion/popup/index": {
                    "p": "fusion/popup/index.77.js",
                    "d": [
                        "fusion/util"
                    ],
                    "a": []
                },
                "zhaopin/home/async": {
                    "p": "zhaopin/home/async.99.js",
                    "d": [
                        "fusion/popup/index"
                    ],
                    "a": []
                },
                "zhaopin/home/header": {
                    "p": "zhaopin/home/index.12.js",
                    "d": [],
                    "a": [
                        "zhaopin/home/async"
                    ]
                },
                "fusion/tab/index": {
                    "p": "fusion/tab/index.66.js",
                    "d": [
                        "fusion/util"
                    ],
                    "a": []
                },
                "zhaopin/home/index": {
                    "p": "zhaopin/home/index.12.js",
                    "d": [
                        "zhaopin/home/header",
                        "fusion/tab/index"
                    ],
                    "a": []
                },
                "zhaopin/home/branch": {
                    "p": "zhaopin/home/branch.33.js",
                    "d": [
                        "fusion/tab/index"
                    ],
                    "a": []
                }
            }
        };
        var jetLoader = new JetLoader(jetOpt);
        jetLoader.run();

        require(['zhaopin/home/index'], function () {
            setTimeout(function () {
                // home/async模块正确执行
                expect(window['mod-async']).toBe(true);
                done();
            }, 500);
        });
    });

});



describe('jet-loader测试二', function() {

    beforeEach(function(done) {
        jasmine.Ajax.install();

        jasmine.Ajax.stubRequest(
             /.*\/dep/
        ).andReturn({
            status: 200,
            statusText: 'HTTP/1.1 200 OK',
            contentType: 'application/json; charset=utf-8',
            responseText: '{"status":0,"data":{"fusion/util":{"p":"fusion/util.20.js","d":[],"a":[]},"fusion/popup/index":{"p":"fusion/popup/index.77.js","d":["fusion/util"],"a":[]},"zhaopin/home/async":{"p":"zhaopin/home/async.99.js","d":["fusion/popup/index"],"a":[]}}}'
        });

        resetEsl(done);
    });

    afterEach(function () {
        jasmine.Ajax.uninstall();
    });

    it('缺少加载模块的依赖配置时，jet-loader动态请求依赖配置并加载模块执行', function (done) {
        // 模块的依赖映射关系
        var jetOpt = {
            map: {
                "fusion/util": {
                    "p": "fusion/util.20.js",
                    "d": [],
                    "a": []
                },
                // "fusion/popup/index": {
                //     "p": "fusion/popup/index.77.js",
                //     "d": [
                //         "fusion/util"
                //     ],
                //     "a": []
                // },
                // "zhaopin/home/async": {
                //     "p": "zhaopin/home/async.99.js",
                //     "d": [
                //         "fusion/popup/index"
                //     ],
                //     "a": []
                // },
                "zhaopin/home/header": {
                    "p": "zhaopin/home/index.12.js",
                    "d": [],
                    "a": [
                        "zhaopin/home/async"
                    ]
                },
                "fusion/tab/index": {
                    "p": "fusion/tab/index.66.js",
                    "d": [
                        "fusion/util"
                    ],
                    "a": []
                },
                "zhaopin/home/index": {
                    "p": "zhaopin/home/index.12.js",
                    "d": [
                        "zhaopin/home/header",
                        "fusion/tab/index"
                    ],
                    "a": []
                },
                "zhaopin/home/branch": {
                    "p": "zhaopin/home/branch.33.js",
                    "d": [
                        "fusion/tab/index"
                    ],
                    "a": []
                }
            }
        };
        var jetLoader = new JetLoader(jetOpt);
        jetLoader.run();
        // 没有该模块关系
        expect(jetLoader.map['zhaopin/home/async']).toBeUndefined();
        window['mod-async'] = false;
        require(['zhaopin/home/index'], function () {
            // 等待zhaopin/home/async模块加载完毕
            setTimeout(function () {
                // 有该模块关系
                expect(jetLoader.map['zhaopin/home/async']).not.toBeUndefined();
                // home/async模块正确执行
                expect(window['mod-async']).toBe(true);
                done();
            }, 500);
        });
    });
});
