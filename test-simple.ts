/**
 * 简单测试脚本 - 验证 Agent 是否能正常工作
 * 运行: tsx test-simple.ts
 */

import { analyzeTx } from './src/index.js';

// 使用一个真实的以太坊交易
// 这是一笔简单的 ETH 转账交易
const TEST_TX = '0xdee6e0ff31681f0fcf80a0a91e520cd42afae660f63e3dd90fa50d525adbb7cd';

async function testAgent() {
  console.log('🧪 测试 MEV Agent...\n');
  console.log(`测试交易: ${TEST_TX}`);
  console.log('这可能需要 10-30 秒...\n');
  
  try {
    const result = await analyzeTx(TEST_TX);
    
    console.log('\n✅ 测试成功！\n');
    console.log('='.repeat(60));
    console.log(result.finalReport?.summary || '无输出');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    
    if (error instanceof Error && error.message.includes('apiKey')) {
      console.log('\n💡 提示: 请在 .env 文件中配置 ANTHROPIC_API_KEY');
    }
  }
}

testAgent();
