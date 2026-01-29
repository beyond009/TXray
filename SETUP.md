# 🚀 配置指南

## 方式 1: 使用 OpenRouter（推荐）

### 为什么选择 OpenRouter？
- ✅ 一个 API Key 访问多个 LLM（Claude、GPT-4、Gemini 等）
- ✅ 按使用付费，无月费
- ✅ 比官方 API 更灵活
- ✅ 支持模型切换，方便对比效果

### 1. 获取 OpenRouter API Key

1. 访问：https://openrouter.ai/keys
2. 使用 Google/GitHub 登录
3. 点击 "Create Key"
4. 复制 API Key（格式：`sk-or-v1-xxxxx`）

### 2. 配置 .env 文件

编辑项目根目录的 `.env` 文件：

```bash
# 使用 OpenRouter
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-你的key

# 选择模型（推荐 Claude 3.5 Sonnet）
LLM_MODEL=anthropic/claude-3.5-sonnet

# 区块链 RPC（使用免费公共节点）
ETHEREUM_RPC_URL=https://eth.llamarpc.com
CHAIN_ID=1
```

### 3. 运行测试

```bash
tsx test-simple.ts
```

---

## 方式 2: 使用 Anthropic 官方 API

### 1. 获取 Anthropic API Key

1. 访问：https://console.anthropic.com/
2. 注册账号（需要信用卡）
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制 Key（格式：`sk-ant-xxxxx`）

### 2. 配置 .env 文件

```bash
# 使用 Anthropic 官方 API
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-你的key
LLM_MODEL=claude-3-5-sonnet-20241022

ETHEREUM_RPC_URL=https://eth.llamarpc.com
CHAIN_ID=1
```

---

## 🎯 支持的模型

### OpenRouter 模型（推荐）

| 模型 | 配置值 | 适用场景 |
|------|--------|---------|
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | 最推荐，分析准确 |
| GPT-4 Turbo | `openai/gpt-4-turbo` | 备选方案 |
| Gemini Pro 1.5 | `google/gemini-pro-1.5` | 性价比高 |
| Claude 3 Opus | `anthropic/claude-3-opus` | 最强但较贵 |

完整列表：https://openrouter.ai/models

### Anthropic 官方模型

| 模型 | 配置值 | 说明 |
|------|--------|------|
| Claude 3.5 Sonnet | `claude-3-5-sonnet-20241022` | 最新最强 |
| Claude 3 Haiku | `claude-3-haiku-20240307` | 快速便宜 |

---

## 💰 费用对比

### OpenRouter 价格（参考）
- **Claude 3.5 Sonnet**: ~$3 / 百万 token（输入），$15 / 百万 token（输出）
- **GPT-4 Turbo**: ~$10 / 百万 token
- **Gemini Pro**: 免费额度 + 极低价格

### Anthropic 官方价格
- **Claude 3.5 Sonnet**: $3 / 百万 token（输入），$15 / 百万 token（输出）
- 需要信用卡，首次充值最低 $5

### 单次分析成本估算
- 每次交易分析约消耗 5k-20k tokens
- 使用 Claude 3.5 Sonnet 约 $0.03 - $0.15 / 次
- 建议先充值 $5-10 测试

---

## 🔧 可选配置

### Etherscan API（提升合约识别能力）

1. 访问：https://etherscan.io/apis
2. 免费注册并创建 API Key
3. 添加到 `.env`：

```bash
ETHERSCAN_API_KEY=你的key
```

### 使用私有 RPC（提升速度）

```bash
# Alchemy (推荐)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Infura
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
```

---

## ✅ 验证配置

运行测试脚本：

```bash
tsx test-simple.ts
```

成功的话会看到交易分析结果！

---

## ❓ 常见问题

### Q: OpenRouter 和 Anthropic 官方有什么区别？
A: 
- OpenRouter 是聚合平台，一个 key 访问多个模型，方便切换
- Anthropic 官方只能用 Claude，但可能响应更稳定
- 价格基本相同

### Q: 推荐哪个？
A: 
- **新手**：OpenRouter，注册简单，无需信用卡即可测试
- **生产环境**：Anthropic 官方，SLA 保障更好

### Q: 能用免费的模型吗？
A: 可以，OpenRouter 有些模型有免费额度，在 `.env` 中设置：
```bash
LLM_MODEL=google/gemini-pro  # Gemini 有免费额度
```

### Q: API 调用失败怎么办？
A: 检查：
1. API Key 是否正确
2. 是否有余额（OpenRouter 可以在网站查看）
3. 网络是否能访问（可能需要代理）
