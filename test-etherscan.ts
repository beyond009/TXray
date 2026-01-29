#!/usr/bin/env tsx
/**
 * Etherscan API 功能测试脚本
 * 用于独立测试所有 Etherscan API 功能
 * 
 * 运行: pnpm exec tsx test-etherscan.ts
 */

import { 
  getContractName, 
  getContractABI,
  getAddressLabel,
  getInternalTransactions,
  getTokenInfo,
  getGasPriceAtBlock,
} from './src/tools/etherscan.js';

import { getKnownAddressLabel } from './src/tools/known-addresses.js';

// 测试用例
const TEST_CASES = {
  // Uniswap V2 Router (已知合约)
  uniswapV2Router: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  
  // Uniswap V3 Router
  uniswapV3Router: '0xe592427a0aece92de3edee1f18e0157c05861564',
  
  // USDC Token
  usdcToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  
  // 一个真实交易（有内部交易）
  txWithInternalCalls: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
  
  // 随机地址（测试不存在的情况）
  randomAddress: '0x1234567890123456789012345678901234567890',
};

function printSeparator() {
  console.log('─'.repeat(70));
}

async function testLocalDatabase() {
  console.log('\n📚 测试 1: 本地地址数据库');
  printSeparator();
  
  const addresses = [
    TEST_CASES.uniswapV2Router,
    TEST_CASES.uniswapV3Router,
    TEST_CASES.usdcToken,
    TEST_CASES.randomAddress,
  ];
  
  for (const addr of addresses) {
    const label = getKnownAddressLabel(addr);
    if (label) {
      console.log(`✅ ${addr.slice(0, 10)}... → ${label}`);
    } else {
      console.log(`❌ ${addr.slice(0, 10)}... → 未找到`);
    }
  }
}

async function testContractName() {
  console.log('\n📝 测试 2: 获取合约名称 (getContractName)');
  printSeparator();
  
  const addresses = [
    { addr: TEST_CASES.uniswapV2Router, desc: 'Uniswap V2 Router' },
    { addr: TEST_CASES.usdcToken, desc: 'USDC Token' },
    { addr: TEST_CASES.randomAddress, desc: '随机地址' },
  ];
  
  for (const { addr, desc } of addresses) {
    console.log(`\n测试地址: ${desc}`);
    console.log(`地址: ${addr}`);
    
    try {
      const startTime = Date.now();
      const name = await getContractName(addr);
      const duration = Date.now() - startTime;
      
      if (name) {
        console.log(`✅ 合约名称: ${name} (${duration}ms)`);
      } else {
        console.log(`⚠️  未找到合约名称 (${duration}ms)`);
      }
    } catch (error) {
      console.log(`❌ 错误: ${error}`);
    }
  }
}

async function testAddressLabel() {
  console.log('\n🏷️  测试 3: 获取地址标签 (getAddressLabel)');
  printSeparator();
  
  const addresses = [
    { addr: TEST_CASES.uniswapV2Router, desc: 'Uniswap V2 Router' },
    { addr: TEST_CASES.uniswapV3Router, desc: 'Uniswap V3 Router' },
    { addr: TEST_CASES.randomAddress, desc: '随机地址' },
  ];
  
  for (const { addr, desc } of addresses) {
    console.log(`\n测试地址: ${desc}`);
    console.log(`地址: ${addr}`);
    
    try {
      const startTime = Date.now();
      const label = await getAddressLabel(addr);
      const duration = Date.now() - startTime;
      
      if (label) {
        console.log(`✅ 标签: ${label} (${duration}ms)`);
      } else {
        console.log(`⚠️  未找到标签 (${duration}ms)`);
      }
    } catch (error) {
      console.log(`❌ 错误: ${error}`);
    }
  }
}

async function testInternalTransactions() {
  console.log('\n🔄 测试 4: 获取内部交易 (getInternalTransactions)');
  printSeparator();
  
  console.log(`\n测试交易: ${TEST_CASES.txWithInternalCalls}`);
  
  try {
    const startTime = Date.now();
    const internalTxs = await getInternalTransactions(TEST_CASES.txWithInternalCalls);
    const duration = Date.now() - startTime;
    
    console.log(`✅ 找到 ${internalTxs.length} 笔内部交易 (${duration}ms)`);
    
    if (internalTxs.length > 0) {
      console.log('\n前 3 笔内部交易:');
      internalTxs.slice(0, 3).forEach((tx: any, i: number) => {
        console.log(`  ${i + 1}. ${tx.type || 'call'}: ${tx.from.slice(0, 10)}... → ${tx.to.slice(0, 10)}...`);
        console.log(`     Value: ${tx.value || '0'} wei`);
      });
    }
  } catch (error) {
    console.log(`❌ 错误: ${error}`);
  }
}

async function testTokenInfo() {
  console.log('\n💰 测试 5: 获取代币信息 (getTokenInfo)');
  printSeparator();
  
  const tokens = [
    { addr: TEST_CASES.usdcToken, desc: 'USDC' },
    { addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', desc: 'USDT' },
  ];
  
  for (const { addr, desc } of tokens) {
    console.log(`\n测试代币: ${desc}`);
    console.log(`地址: ${addr}`);
    
    try {
      const startTime = Date.now();
      const info = await getTokenInfo(addr);
      const duration = Date.now() - startTime;
      
      if (info) {
        console.log(`✅ 代币信息 (${duration}ms):`);
        console.log(`   名称: ${info.name || 'N/A'}`);
        console.log(`   符号: ${info.symbol || 'N/A'}`);
        console.log(`   小数位: ${info.decimals || 'N/A'}`);
        console.log(`   总供应量: ${info.totalSupply || 'N/A'}`);
      } else {
        console.log(`⚠️  未找到代币信息 (${duration}ms)`);
      }
    } catch (error) {
      console.log(`❌ 错误: ${error}`);
    }
  }
}

async function testGasPrice() {
  console.log('\n⛽ 测试 6: 获取 Gas 价格 (getGasPriceAtBlock)');
  printSeparator();
  
  console.log(`\n测试区块: 20000000`);
  
  try {
    const startTime = Date.now();
    const gasPrice = await getGasPriceAtBlock(20000000);
    const duration = Date.now() - startTime;
    
    if (gasPrice) {
      console.log(`✅ Gas 价格信息 (${duration}ms):`);
      console.log(`   建议价格: ${gasPrice.gasPrice || 'N/A'} Gwei`);
      console.log(`   基础费用: ${gasPrice.baseFee || 'N/A'} Gwei`);
    } else {
      console.log(`⚠️  未找到 Gas 价格信息 (${duration}ms)`);
    }
  } catch (error) {
    console.log(`❌ 错误: ${error}`);
  }
}

async function testContractABI() {
  console.log('\n📜 测试 7: 获取合约 ABI (getContractABI)');
  printSeparator();
  
  console.log(`\n测试合约: Uniswap V2 Router`);
  console.log(`地址: ${TEST_CASES.uniswapV2Router}`);
  
  try {
    const startTime = Date.now();
    const abi = await getContractABI(TEST_CASES.uniswapV2Router);
    const duration = Date.now() - startTime;
    
    if (abi && Array.isArray(abi)) {
      console.log(`✅ ABI 获取成功 (${duration}ms)`);
      console.log(`   函数数量: ${abi.filter((item: any) => item.type === 'function').length}`);
      console.log(`   事件数量: ${abi.filter((item: any) => item.type === 'event').length}`);
      
      // 显示前 3 个函数
      const functions = abi.filter((item: any) => item.type === 'function').slice(0, 3);
      if (functions.length > 0) {
        console.log('\n   前 3 个函数:');
        functions.forEach((fn: any) => {
          console.log(`     - ${fn.name}(${fn.inputs?.map((i: any) => i.type).join(', ') || ''})`);
        });
      }
    } else {
      console.log(`⚠️  未找到 ABI (${duration}ms)`);
    }
  } catch (error) {
    console.log(`❌ 错误: ${error}`);
  }
}

async function checkAPIKey() {
  console.log('\n🔑 检查 API Key 配置');
  printSeparator();
  
  const apiKey = process.env.ETHERSCAN_API_KEY;
  
  if (apiKey && apiKey !== 'YOUR_KEY_HERE') {
    console.log(`✅ API Key 已配置: ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`);
    return true;
  } else {
    console.log(`⚠️  API Key 未配置或使用默认值`);
    console.log(`   请在 .env 文件中设置 ETHERSCAN_API_KEY`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('🧪 Etherscan API 功能测试');
  console.log('═'.repeat(70));
  
  const hasAPIKey = await checkAPIKey();
  
  if (!hasAPIKey) {
    console.log('\n⚠️  警告: 没有 API Key，某些测试将失败或使用本地数据');
  }
  
  console.log('\n开始测试...\n');
  
  try {
    // 测试 1: 本地数据库（不需要 API）
    await testLocalDatabase();
    
    // 测试 2-7: Etherscan API
    await testContractName();
    await testAddressLabel();
    await testInternalTransactions();
    await testTokenInfo();
    await testGasPrice();
    await testContractABI();
    
    console.log('\n' + '═'.repeat(70));
    console.log('✅ 所有测试完成！');
    console.log('═'.repeat(70));
    
    console.log('\n📊 总结:');
    console.log('- 本地数据库: 始终可用（无需网络）');
    console.log('- Etherscan API: 需要有效的 API Key 和网络连接');
    console.log('- 如果看到超时，可能需要配置代理或等待 API 响应');
    
  } catch (error) {
    console.error('\n❌ 测试过程出错:', error);
  }
}

// 运行测试
main().catch(console.error);
