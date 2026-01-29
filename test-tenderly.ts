/**
 * Tenderly 集成测试脚本
 * 
 * 测试 Tenderly 的 tenderly_simulateTransaction 功能
 */

import { simulateTransaction, extractAllCalls, extractTokenTransfers, analyzeGasUsage } from './src/tools/tenderly.js';

// 测试交易（Uniswap V2 swap）
const TEST_TX = '0x5e1b1de8504bed6fc94e5cd87be7a42b28efe75fae7214b51ca57a5340b3826b';

async function main() {
  console.log('🧪 Testing Tenderly Integration\n');
  console.log(`Transaction: ${TEST_TX}\n`);
  console.log('═'.repeat(70));
  
  try {
    // 1. 模拟交易
    const result = await simulateTransaction(TEST_TX);
    
    if (!result) {
      console.log('\n❌ Simulation failed or Tenderly not configured');
      console.log('\n💡 Tip: Configure TENDERLY_RPC_URL in .env');
      console.log('   Example: TENDERLY_RPC_URL=https://mainnet.gateway.tenderly.co/YOUR_KEY');
      process.exit(1);
    }
    
    console.log('\n📊 Simulation Results:');
    console.log('═'.repeat(70));
    
    // 2. 基础信息
    console.log(`\n✅ Status: ${result.status ? 'Success' : 'Failed'}`);
    console.log(`⛽ Gas Used: ${result.gasUsed}`);
    if (result.gasPrice) {
      console.log(`💰 Gas Price: ${result.gasPrice}`);
    }
    
    // 3. 调用轨迹
    if (result.trace && result.trace.length > 0) {
      console.log(`\n📞 Call Trace (${result.trace.length} top-level calls):`);
      console.log('═'.repeat(70));
      
      const allCalls = extractAllCalls(result.trace);
      console.log(`   Total Calls: ${allCalls.length}`);
      
      // 显示前 10 个调用
      allCalls.slice(0, 10).forEach((call, i) => {
        console.log(`\n   ${i + 1}. ${call.type}: ${call.from.slice(0, 10)}... → ${call.to.slice(0, 10)}...`);
        if (call.function) {
          console.log(`      Function: ${call.function}`);
        }
        if (call.functionSignature) {
          console.log(`      Signature: ${call.functionSignature}`);
        }
        if (call.gasUsed) {
          console.log(`      Gas Used: ${call.gasUsed}`);
        }
        if (call.value && call.value !== '0x0' && call.value !== '0') {
          console.log(`      Value: ${BigInt(call.value)} wei`);
        }
        if (call.error) {
          console.log(`      ❌ Error: ${call.error}`);
        }
      });
      
      if (allCalls.length > 10) {
        console.log(`\n   ... and ${allCalls.length - 10} more calls`);
      }
      
      // Gas 分析
      console.log(`\n⛽ Gas Analysis:`);
      console.log('═'.repeat(70));
      const gasAnalysis = analyzeGasUsage(result.trace);
      console.log(`   Total Gas: ${gasAnalysis.totalGas.toString()}`);
      console.log(`   Contracts Called: ${Object.keys(gasAnalysis.byContract).length}`);
      
      // 显示 Gas 使用最多的合约
      const topContracts = Object.entries(gasAnalysis.byContract)
        .sort(([, a], [, b]) => Number(b - a))
        .slice(0, 5);
      
      console.log(`\n   Top Gas Consumers:`);
      topContracts.forEach(([contract, gas], i) => {
        const percentage = (Number(gas) / Number(gasAnalysis.totalGas) * 100).toFixed(2);
        console.log(`   ${i + 1}. ${contract.slice(0, 10)}... - ${gas.toString()} (${percentage}%)`);
      });
      
      // 显示 Gas 使用最多的函数
      if (Object.keys(gasAnalysis.byFunction).length > 0) {
        console.log(`\n   Top Functions by Gas:`);
        const topFunctions = Object.entries(gasAnalysis.byFunction)
          .sort(([, a], [, b]) => Number(b - a))
          .slice(0, 5);
        
        topFunctions.forEach(([func, gas], i) => {
          const percentage = (Number(gas) / Number(gasAnalysis.totalGas) * 100).toFixed(2);
          console.log(`   ${i + 1}. ${func} - ${gas.toString()} (${percentage}%)`);
        });
      }
    }
    
    // 4. 日志
    if (result.logs && result.logs.length > 0) {
      console.log(`\n📝 Logs (${result.logs.length}):`);
      console.log('═'.repeat(70));
      
      result.logs.slice(0, 5).forEach((log, i) => {
        console.log(`\n   ${i + 1}. Address: ${log.address}`);
        if (log.name) {
          console.log(`      Event: ${log.name}`);
        }
        if (log.signature) {
          console.log(`      Signature: ${log.signature}`);
        }
        if (log.decoded) {
          console.log(`      Decoded: ${JSON.stringify(log.decoded).slice(0, 100)}...`);
        }
      });
      
      if (result.logs.length > 5) {
        console.log(`\n   ... and ${result.logs.length - 5} more logs`);
      }
    }
    
    // 5. 资产变化
    if (result.assetChanges && result.assetChanges.length > 0) {
      console.log(`\n💎 Asset Changes (${result.assetChanges.length}):`);
      console.log('═'.repeat(70));
      
      result.assetChanges.forEach((change, i) => {
        console.log(`\n   ${i + 1}. ${change.type.toUpperCase()}`);
        console.log(`      Token: ${change.address}`);
        if (change.tokenInfo) {
          console.log(`      Symbol: ${change.tokenInfo.symbol || 'Unknown'}`);
          console.log(`      Name: ${change.tokenInfo.name || 'Unknown'}`);
        }
        if (change.from) {
          console.log(`      From: ${change.from}`);
        }
        if (change.to) {
          console.log(`      To: ${change.to}`);
        }
        if (change.amount) {
          console.log(`      Amount: ${change.amount}`);
        }
        if (change.tokenId) {
          console.log(`      Token ID: ${change.tokenId}`);
        }
      });
      
      // 提取代币转账
      const transfers = extractTokenTransfers(result);
      if (transfers.length > 0) {
        console.log(`\n   🪙 Token Transfers:`);
        transfers.forEach((transfer, i) => {
          console.log(`   ${i + 1}. ${transfer.symbol || 'Unknown'}: ${transfer.from.slice(0, 10)}... → ${transfer.to.slice(0, 10)}...`);
          console.log(`      Amount: ${transfer.amount}`);
        });
      }
    }
    
    // 6. 余额变化
    if (result.balanceChanges && result.balanceChanges.length > 0) {
      console.log(`\n💰 Balance Changes (${result.balanceChanges.length}):`);
      console.log('═'.repeat(70));
      
      result.balanceChanges.forEach((change, i) => {
        const delta = BigInt(change.delta);
        const sign = delta >= 0n ? '+' : '';
        console.log(`   ${i + 1}. ${change.address}`);
        console.log(`      Change: ${sign}${delta.toString()} wei`);
        console.log(`      Before: ${change.original}`);
        console.log(`      After: ${change.dirty}`);
      });
    }
    
    // 7. 状态变化
    if (result.stateChanges && result.stateChanges.length > 0) {
      console.log(`\n🔄 State Changes (${result.stateChanges.length}):`);
      console.log('═'.repeat(70));
      
      result.stateChanges.slice(0, 5).forEach((change, i) => {
        console.log(`\n   ${i + 1}. Contract: ${change.address}`);
        console.log(`      Slot: ${change.slot}`);
        console.log(`      Before: ${change.original}`);
        console.log(`      After: ${change.dirty}`);
      });
      
      if (result.stateChanges.length > 5) {
        console.log(`\n   ... and ${result.stateChanges.length - 5} more state changes`);
      }
    }
    
    // 8. Nonce 变化
    if (result.nonceChange && result.nonceChange.length > 0) {
      console.log(`\n🔢 Nonce Changes (${result.nonceChange.length}):`);
      console.log('═'.repeat(70));
      
      result.nonceChange.forEach((change, i) => {
        console.log(`   ${i + 1}. ${change.address}: ${change.original} → ${change.dirty}`);
      });
    }
    
    // 9. 代码变化
    if (result.codeChange && result.codeChange.length > 0) {
      console.log(`\n📜 Code Changes (${result.codeChange.length}):`);
      console.log('═'.repeat(70));
      
      result.codeChange.forEach((change, i) => {
        console.log(`   ${i + 1}. ${change.address}`);
        console.log(`      New Code Length: ${change.dirty?.length || 0} bytes`);
      });
    }
    
    console.log('\n' + '═'.repeat(70));
    console.log('✅ Test completed successfully!');
    console.log('\n💡 Tenderly provides much more detailed information than Etherscan!');
    console.log('   - Decoded function calls');
    console.log('   - Complete call trace with parameters');
    console.log('   - Asset changes with token info');
    console.log('   - State changes tracking');
    console.log('   - Balance changes');
    console.log('   - And all of this for FREE! 🎉');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
