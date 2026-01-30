#!/usr/bin/env node
import { analyzeTx } from './graph/workflow.js';

/**
 * CLI 工具用于分析交易
 * 使用方式: npm run analyze -- 0x<tx_hash>
 */

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🔍 MEV Transaction Analyzer

使用方式:
  npm run analyze -- <transaction_hash>

示例:
  npm run analyze -- 0x1234567890abcdef...

说明:
  分析一笔以太坊交易，识别 MEV 行为并生成易懂的解释
    `);
    process.exit(0);
  }
  
  const txHash = args[0];
  
  // 验证交易哈希格式
  if (!txHash.startsWith('0x') || txHash.length !== 66) {
    console.error('❌ 无效的交易哈希格式。应为 0x 开头的 66 字符十六进制字符串');
    process.exit(1);
  }
  
  console.log(`\n🚀 开始分析交易: ${txHash}\n`);
  console.log('─'.repeat(60));
  
  try {
    const result = await analyzeTx(txHash);
    
    
    if (result.error) {
      console.error('❌ 错误:', result.error);
      process.exit(1);
    }
    
    if (result.finalReport && typeof result.finalReport === 'object') {
      const report = result.finalReport as {
        mevType: string;
        summary: string;
        tokenFlows: any[];
        technicalDetails: Record<string, any>;
        tenderlySimulation?: any;
      };
      
      if (report.tenderlySimulation) {
        console.log('\n' + '─'.repeat(60));
        console.log('\n🎭 Tenderly 模拟结果:');
        console.log(`  状态: ${report.tenderlySimulation.status ? '✅ 成功' : '❌ 失败'}`);
        console.log(`  Gas 使用: ${report.tenderlySimulation.gasUsed}`);
        
        // 调用轨迹
        if (report.tenderlySimulation.trace) {
          const allCalls = extractAllCallsForDisplay(report.tenderlySimulation.trace);
          console.log(`\n  📞 调用链 (${allCalls.length} 个调用):`);
          allCalls.slice(0, 5).forEach((call: any, i: number) => {
            console.log(`    ${i + 1}. ${call.type}: ${call.from.slice(0, 10)}... → ${call.to.slice(0, 10)}...`);
            if (call.function_name) {
              console.log(`       函数: ${call.function_name}`);
            }
          });
          if (allCalls.length > 5) {
            console.log(`    ... 还有 ${allCalls.length - 5} 个调用`);
          }
        }
        
        // 资产变化
        if (report.tenderlySimulation.assetChanges && report.tenderlySimulation.assetChanges.length > 0) {
          console.log(`\n  💎 资产变化 (${report.tenderlySimulation.assetChanges.length} 笔):`);
          report.tenderlySimulation.assetChanges.slice(0, 3).forEach((change: any, i: number) => {
            console.log(`    ${i + 1}. ${change.type}`);
            if (change.symbol) {
              console.log(`       代币: ${change.symbol}`);
            }
            console.log(`       ${change.from?.slice(0, 10)}... → ${change.to?.slice(0, 10)}...`);
          });
          if (report.tenderlySimulation.assetChanges.length > 3) {
            console.log(`    ... 还有 ${report.tenderlySimulation.assetChanges.length - 3} 笔`);
          }
        }
        
        // 余额变化
        if (report.tenderlySimulation.balanceChanges && report.tenderlySimulation.balanceChanges.length > 0) {
          console.log(`\n  💰 ETH 余额变化 (${report.tenderlySimulation.balanceChanges.length} 个地址):`);
          report.tenderlySimulation.balanceChanges.slice(0, 3).forEach((change: any, i: number) => {
            const ethChange = (BigInt(change.dirty_value || '0') - BigInt(change.original_value || '0')) / BigInt(10 ** 18);
            const changeStr = ethChange >= 0 ? `+${ethChange}` : ethChange.toString();
            console.log(`    ${i + 1}. ${change.address.slice(0, 10)}...: ${changeStr} ETH`);
          });
          if (report.tenderlySimulation.balanceChanges.length > 3) {
            console.log(`    ... 还有 ${report.tenderlySimulation.balanceChanges.length - 3} 个地址`);
          }
        }
      }
      
      console.log('\n');
    }
    
    function extractAllCallsForDisplay(call: any, calls: any[] = []): any[] {
      calls.push(call);
      if (call.calls) {
        for (const subcall of call.calls) {
          extractAllCallsForDisplay(subcall, calls);
        }
      }
      return calls;
    }
    
  } catch (error) {
    console.error('\n❌ 分析失败:', error);
    process.exit(1);
  }
}

main();
