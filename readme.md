# jet-loader
当前项目里可能存在以下几种问题
1. 一个组件一个js文件，因为系统原因，也不能简单打包文件，导致页面加载许多js文件，不符合优化规范
2. 即使在项目里按照规范打包，也会出现该页面加载的打包文件有一部分是该页面不需要的模块，导致资源加载多余

jet项目就是为了去解决这么问题的

Jet，将提供以下解决方案：
* 通用代码将通过包管理的方式来进行，并提供适合Web的AMD声明机制；
* 代码组织方式通过更严格的AMD子集标准来体现，并且是平铺式的文件粒度的Define；
* 页面的模块依赖方式将被动态的解析处理，结合应用场景完成智能化打包合并资源请求；

而jet-loader就是整个jet系统至关重要的一环，在页面里实现按照页面所需动态加载模块，并实现诸如，combo、cdn等服务和各种打包，缓存优化

## 依赖
1. 定制版esl： 代码在test/esl.js

## 使用

```html
<script src="./esl.js"></script>
<script src="./jet-loader.js"></script>
<script>
var jetOpt = {
   map: {} // 模块的依赖映射关系
};
var jetLoader = new JetLoader(jetOpt);
jetLoader.run();
</script>
```

## 模块依赖关系说明
以模块`zhaopin/home/index`说明
```javascript
{
    'zhaopin/home/index': {
        p: 'zhaopin/home/index.12.js', // 模块`zhaopin/home/index` 的 实际代码地址
        d: ['fusion/tab/index'], // 模块`zhaopin/home/index` 的强依赖，必须要先加载好，模块才能执行，即 require('zhaopin/home/async')
        a: ['zhaopin/home/async'] // 模块`zhaopin/home/index` 的弱依赖或叫异步依赖，即require(['zhaopin/home/async'])
    },
}
```

以下为mock的某项目的模块的依赖映射关系
```javascript
var map = {
    'zhaopin/home/index': {
        p: 'zhaopin/home/index.12.js', // path
        d: ['fusion/tab/index'], // deps
        a: ['zhaopin/home/async'] // async deps 动态require
    },
    'zhaopin/home/header': {
        p: 'zhaopin/home/index.12.js', // path
        d: [], // deps
        a: [] // async deps 动态require
    },
    'zhaopin/home/async': {
        p: 'zhaopin/home/async.99.js', // path
        d: ['fusion/popup/index'], // deps
        a: []
    },
    'zhaopin/home/branch': {
        p: 'zhaopin/home/branch.33.js', // path
        d: ['fusion/tab/index'], // deps
        a: []
    },
    'fusion/tab/index': {
        p: 'fusion/tab/index.66.js', // path
        d: ['fusion/util'], // deps
        a: []
    },
    'fusion/popup/index': {
        p: 'fusion/popup/index.77.js', // path
        d: ['fusion/util'], // deps
        a: []
    },
    'fusion/util': {
        p: 'fusion/util.20.js', // path
        d: [], // deps
        a: []
    }
};
```

## 模块依赖关系生成
靠手动去写下项目里的所有模块依赖关系，几乎不可行
因此为了自动获取项目的模块依赖关系，目前已经提供一款 [静态模块分析工具](https://github.com/jetwg/jet-analyser)
