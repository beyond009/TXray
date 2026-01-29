# MEV/EVM Transaction Analysis Agent

使用 LangGraph 和 TypeScript 构建的 MEV (Miner Extractable Value) / EVM 交易分析智能代理，专门用于分析复杂的区块链交易，并用易于理解的自然语言解释交易详情。

## ✨ 特性

- 🔍 **深度交易分析** - 使用 Tenderly 完整模拟交易执行
- 🎯 **MEV 模式识别** - 识别 Sandwich、Arbitrage、Liquidation 等 MEV 策略
- 🤖 **AI 驱动解释** - 使用 LLM 生成自然语言分析报告
- 📊 **完整数据追踪** - 调用轨迹、状态变化、资产流动全面追踪
- 🔄 **智能数据源** - RPC → Tenderly → Etherscan 多层数据获取
- 💰 **成本优化** - 优先使用免费 API，智能筛选必要请求

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/mevagent.git
cd mevagent
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 必需：LLM API Key（至少配置一个）
OPENROUTER_API_KEY=sk-or-v1-...
# 或
# ANTHROPIC_API_KEY=sk-ant-...

# 推荐：Tenderly RPC（免费，提供最详细的交易数据）
TENDERLY_RPC_URL=https://mainnet.gateway.tenderly.co/YOUR_KEY
USE_TENDERLY_SIMULATION=true

# 可选：Etherscan API（用于合约 ABI 和源码）
ETHERSCAN_API_KEY=YOUR_KEY

# 基础配置
ETHEREUM_RPC_URL=https://eth.llamarpc.com
CHAIN_ID=1
```

### 4. 运行测试

```bash
# 测试基础功能
pnpm exec tsx test-simple.ts

# 测试 Tenderly 集成
pnpm exec tsx test-tenderly.ts

# 测试 Etherscan 功能
pnpm run test:etherscan
```

### 5. 使用代理（可选）

如果你需要代理访问某些服务：

```bash
./run-with-proxy.sh pnpm exec tsx test-simple.ts
```

## 📚 架构

### LangGraph 工作流

```
┌──────────┐      ┌──────────┐      ┌──────────┐
│  Extract │─────>│  Draft   │─────>│  Output  │
│   Node   │      │   Node   │      │   Node   │
└──────────┘      └──────────┘      └──────────┘
     │
     ├─> RPC: 基础交易数据
     ├─> Tenderly: 完整模拟执行 ⭐
     ├─> Etherscan: 合约 ABI/源码
     └─> Local DB: 地址标签
```

### 数据源优先级

1. **RPC** (免费，快速) - 基础交易数据
2. **Tenderly** (免费，详细) - 完整执行轨迹、函数解码、状态变化 ⭐
3. **Etherscan** (免费，有限) - 合约 ABI、源码、历史数据
4. **Local DB** (免费，即时) - 常用地址标签

## 🎭 Tenderly 集成（推荐！）

Tenderly 提供了业界最强大的免费交易分析 API：

### 为什么选择 Tenderly？

| 功能 | Etherscan | Tenderly |
|------|-----------|----------|
| 内部交易 | ✅ 基础 | ✅✅✅ 完整调用树 + 解码 |
| 函数解码 | ❌ 需要 ABI | ✅ 自动解码 |
| 参数解码 | ❌ 手动 | ✅ 完整参数 |
| 状态变化 | ❌ 无 | ✅ 完整追踪 |
| 资产变化 | ⚠️ 仅 logs | ✅ 代币信息 + 解码 |
| Gas 分析 | ⚠️ 总量 | ✅ 按合约/函数 |
| 成本 | 🆓 5 req/s | 🆓 25M Gas/月 |

### 快速配置

```bash
# 1. 注册 https://dashboard.tenderly.co/register
# 2. 获取 Access Key
# 3. 配置 .env
TENDERLY_RPC_URL=https://mainnet.gateway.tenderly.co/YOUR_KEY
USE_TENDERLY_SIMULATION=true

# 4. 测试
pnpm exec tsx test-tenderly.ts
```

详见：[docs/TENDERLY_INTEGRATION.md](docs/TENDERLY_INTEGRATION.md)

## 📖 详细文档

- [TENDERLY_INTEGRATION.md](docs/TENDERLY_INTEGRATION.md) - Tenderly 集成指南
- [ADDRESS_LABELS.md](docs/ADDRESS_LABELS.md) - 地址标签获取策略
- [SETUP.md](SETUP.md) - 详细安装指南

## 🔧 项目结构

```
mevagent/
├── src/
│   ├── cli.ts              # 命令行接口
│   ├── index.ts            # 主入口
│   ├── config/
│   │   └── index.ts        # 配置管理
│   ├── graph/
│   │   ├── nodes.ts        # LangGraph 节点
│   │   └── workflow.ts     # 工作流定义
│   ├── mev/
│   │   └── patterns.ts     # MEV 模式识别
│   ├── tools/
│   │   ├── rpc.ts          # RPC 工具（合约检测、代币信息）
│   │   ├── tenderly.ts     # Tenderly 集成 ⭐
│   │   ├── etherscan.ts    # Etherscan API
│   │   └── known-addresses.ts  # 本地地址数据库
│   └── types/
│       └── index.ts        # 类型定义
├── docs/                   # 文档
├── test-simple.ts          # 简单测试
├── test-tenderly.ts        # Tenderly 测试 ⭐
├── test-etherscan.ts       # Etherscan 测试
└── run-with-proxy.sh       # 代理启动脚本
```

## 🎯 使用示例

### CLI 模式

```bash
pnpm run cli 0x5e1b1de8504bed6fc94e5cd87be7a42b28efe75fae7214b51ca57a5340b3826b
```

### 编程模式

```typescript
import { analyzeTx } from './src/index.js';

const result = await analyzeTx(
  '0x5e1b1de8504bed6fc94e5cd87be7a42b28efe75fae7214b51ca57a5340b3826b'
);

console.log(result.finalReport?.summary);
```

## 💡 特性亮点

### 1. 智能数据筛选

```typescript
// 1. RPC 检测合约地址（快速，免费）
const isContract = await isContract(address);

// 2. 只对合约获取 ABI
if (isContract) {
  const abi = await getContractABI(address);
  const source = await getContractSource(address);
}

// 3. 优先使用 RPC 获取代币信息
const tokenInfo = await getTokenInfoFromRPC(tokenAddress);
if (!tokenInfo) {
  // 回退到 Etherscan
  tokenInfo = await getTokenInfo(tokenAddress);
}
```

### 2. 完整的交易模拟

```typescript
// 使用 Tenderly 模拟交易
const simulation = await simulateTransaction(txHash);

if (simulation) {
  // 获取解码后的调用轨迹
  const calls = extractAllCalls(simulation.trace);
  
  // 获取资产变化（自动包含代币信息）
  const transfers = extractTokenTransfers(simulation);
  
  // 分析 Gas 使用
  const gasAnalysis = analyzeGasUsage(simulation.trace);
}
```

### 3. 多层数据融合

```typescript
// 组合多个数据源
const enrichedData = {
  // 从 Tenderly 获取
  decodedCalls: tenderlySimulation.trace,
  assetChanges: tenderlySimulation.assetChanges,
  stateChanges: tenderlySimulation.stateChanges,
  
  // 从 Etherscan 获取
  contractSource: await getContractSource(address),
  
  // 从本地数据库
  addressLabels: getKnownAddressLabel(address),
};
```

## 🔐 安全和隐私

- ✅ 所有 API keys 存储在本地 `.env`
- ✅ 不上传任何私钥或敏感信息
- ✅ 支持自建节点（完全私有）
- ✅ 代理支持（网络隐私）

## 💰 成本分析

| 服务 | 价格 | 用途 | 推荐度 |
|------|------|------|--------|
| **Tenderly** | 🆓 免费 (25M Gas/月) | 完整交易模拟 | ⭐⭐⭐⭐⭐ |
| **OpenRouter (DeepSeek)** | $0.14 / M tokens | LLM 分析 | ⭐⭐⭐⭐⭐ |
| **Etherscan API** | 🆓 免费 (5 req/s) | 合约数据 | ⭐⭐⭐⭐ |
| **公共 RPC** | 🆓 免费 | 基础数据 | ⭐⭐⭐⭐ |

**每月成本：几乎为 0！** 💸

## 🚧 路线图

- [x] Phase 1: MVP (基础 RPC + 简单 MEV 识别)
- [x] Phase 2: Tenderly 集成（完整交易模拟）
- [x] Phase 3: 智能数据筛选（优化 API 调用）
- [x] Phase 4: 多数据源融合
- [ ] Phase 5: 高级 MEV 模式识别
- [ ] Phase 6: 可视化交易流程图
- [ ] Phase 7: 批量分析和历史趋势
- [ ] Phase 8: 自定义规则引擎

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md)

## 📄 许可证

MIT License

## 🙏 致谢

- [Tenderly](https://tenderly.co/) - 提供强大的免费交易模拟 API
- [LangChain](https://www.langchain.com/) - LLM 应用框架
- [Viem](https://viem.sh/) - 以太坊交互库
- [OpenRouter](https://openrouter.ai/) - LLM API 网关

## 📞 联系

- GitHub Issues: [提交问题](https://github.com/your-username/mevagent/issues)
- Twitter: [@your_twitter]
- Discord: [加入社区]

---

**Built with ❤️ for the Ethereum community**
