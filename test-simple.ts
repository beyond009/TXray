/**
 * 简单测试脚本 - 验证 Agent 是否能正常工作
 * 运行: tsx test-simple.ts
 */

import { analyzeTx } from './src/index.js';

// 更多复杂交易见 docs/COMPLEX_TX_EXAMPLES.md
const TEST_TX = '0x2a615005a63785284f11a4c5cb803d1935d34e358c10a3b4d76398d2e7bb2f9d'; // EigenPhi MEV: Compound + Uniswap V3 + Curve

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
