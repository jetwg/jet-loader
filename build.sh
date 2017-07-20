#!/bin/bash
script_path=`dirname $0`
cd $script_path

start_time=$(date +%s)

# 构建
rm -fr ${script_path}/dist
node ./node_modules/fis3/bin/fis.js release -d ${script_path}/dist

# 耗时
end_time=$(date +%s)
compile_time=$(($end_time - $start_time))
echo "builded in ${compile_time}s"
