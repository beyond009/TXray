#!/bin/bash

# 设置代理环境变量
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7891

echo "🌐 代理已设置:"
echo "   HTTP Proxy: $http_proxy"
echo "   HTTPS Proxy: $https_proxy"
echo "   All Proxy: $all_proxy"
echo ""

# 运行传入的命令
if [ $# -eq 0 ]; then
    echo "用法: ./run-with-proxy.sh <命令>"
    echo ""
    echo "示例:"
    echo "  ./run-with-proxy.sh pnpm exec tsx test-etherscan.ts"
    echo "  ./run-with-proxy.sh pnpm exec tsx test-simple.ts"
    echo "  ./run-with-proxy.sh npm run analyze -- 0x123..."
    exit 1
fi

# 执行命令
echo "🚀 运行命令: $@"
echo "─────────────────────────────────────"
echo ""

exec "$@"
