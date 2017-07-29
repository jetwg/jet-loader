
/*module: zhaopin/home/index.12.js*/
define('zhaopin/home/header', function () {
    console.log('zhaopin/home/header inited');

    require(['zhaopin/home/async'], function (Async) {
        window['mod-async'] = true;
        Async.init();
    });
});


define('zhaopin/home/index', ['zhaopin/home/header', 'fusion/tab/index'], function (Header, Tab) {

    console.log('zhaopin/home/index inited');
});

/*module: fusion/util.20.js*/
define('fusion/util', [], function () {

});

/*module: fusion/tab/index.66.js*/
define('fusion/tab/index', ['fusion/util'], function (util) {

});

/*module: zhaopin/home/branch.33.js*/
define('zhaopin/home/branch', ['fusion/tab/index'], function (Tab) {
    console.log('zhaopin/home/branch inited');
});
