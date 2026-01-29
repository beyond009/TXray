import type { Hash } from 'viem';
import { formatUnits } from 'viem';
import type { AnalysisState, DecodedCall } from '../types/index.js';
import { getProgress } from '../chat/progress.js';
import { getTransactionDetails, extractTokenFlows, publicClient, isContract, getTokenInfoFromRPC } from '../tools/rpc.js';
import { getContractABI, getContractSource, getAddressLabel, getInternalTransactions, getTokenInfo, getGasPriceAtBlock } from '../tools/etherscan.js';
import { traceHistoricalTransaction, extractAllCallsFromTrace } from '../tools/tenderly-trace.js';
import { identifyMEVPattern } from '../mev/patterns.js';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config/index.js';
import { decodeFunctionData } from 'viem';

/**
 * Node 1: Extract - 提取交易数据
 */
export async function extractNode(state: AnalysisState): Promise<Partial<AnalysisState>> {
  console.log('🔍 [Extract] Fetching transaction data...');
  console.log(`   Transaction: ${state.txHash}`);
  
  try {
    const txHash = state.txHash as Hash;
    
    // 获取交易详情
    const rawTx = await getTransactionDetails(txHash);
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const tokenFlows = extractTokenFlows(receipt);
    getProgress()?.({ type: 'rpc_done', payload: { blockNumber: rawTx.blockNumber } });

    const { decodeCalldata } = await import('../tools/rpc.js');
    const decodedInput = decodeCalldata(rawTx.input);

    console.log('   🔍 Fetching additional data from Etherscan...');
    getProgress()?.({ type: 'etherscan_start' });
    
    // 导入 Etherscan 工具函数（按需使用）
    
    // 1. 先从本地数据库获取地址标签（无 API 调用）
    console.log('   📝 Getting address labels from local DB...');
    const fromLabel = await getAddressLabel(rawTx.from);
    const toLabel = rawTx.to ? await getAddressLabel(rawTx.to) : null;
    
    // 2. 检测 to 地址是否是合约（通过 RPC，快速且免费）
    const isToContract = rawTx.to ? await isContract(rawTx.to) : false;
    console.log(`   🔍 To address: ${isToContract ? '✓ CONTRACT' : 'EOA (wallet)'}`);
    
    // 3. 只对合约地址获取 ABI 和源码（减少 API 调用，但获取更有价值的信息）
    let contractABI: any[] | null = null;
    let contractSource: string | null = null;
    let decodedFunction: DecodedCall | null = null;
    
    if (isToContract && rawTx.to && rawTx.input && rawTx.input !== '0x') {
      console.log('   📋 Fetching contract ABI and source from Etherscan...');
      
      // 并行获取 ABI 和源码（一次性完成，减少请求）
      [contractABI, contractSource] = await Promise.all([
        getContractABI(rawTx.to),
        getContractSource(rawTx.to), // 源码可选，如果太大可以注释掉
      ]);
      
      // 如果获取到 ABI，解码函数调用
      if (contractABI && contractABI.length > 0) {
        try {
          console.log('   🔓 Decoding function call with ABI...');
          const decoded = decodeFunctionData({
            abi: contractABI,
            data: rawTx.input as Hash,
          });
          
          decodedFunction = {
            contract: rawTx.to,
            functionName: decoded.functionName,
            args: decoded.args as any[],
          };
          
          console.log(`      ✓ Decoded: ${decoded.functionName}(${decoded.args?.length || 0} args)`);
        } catch (error) {
          console.log(`      ⚠️  Failed to decode: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        console.log('      ⚠️  No ABI available (contract not verified)');
      }
      
      if (contractSource) {
        const sourceLength = contractSource.length;
        console.log(`      ✓ Got source code (${sourceLength} chars)`);
        // 如果源码太大，截断或忽略
        if (sourceLength > 50000) {
          console.log(`      ⚠️  Source too large, will be truncated`);
          contractSource = contractSource.slice(0, 50000) + '\n... (truncated)';
        }
      }
    }
    
    console.log('   ⛽ Fetching internal txs and gas price...');
    
    let tenderlyCallTrace: any = null;
    let tenderlyInternalTxs: any[] = [];
    
    if (config.useTenderlySimulation && config.tenderlyRpcUrl) {
      console.log('   🔍 [Tenderly] Fetching historical transaction trace...');
      getProgress()?.({ type: 'tenderly_start' });
      try {
        tenderlyCallTrace = await traceHistoricalTransaction(txHash);
        
        if (tenderlyCallTrace && tenderlyCallTrace.trace) {
          console.log('   ✅ [Tenderly] Trace received!');
          console.log(`      Calls: ${tenderlyCallTrace.trace?.length || 0}`);
          console.log(`      Status: ${tenderlyCallTrace.status ? '✅ Success' : '❌ Failed'}`);
          
          // 验证一致性
          const tenderlyGasUsed = parseInt(tenderlyCallTrace.gasUsed, 16) || 0;
          const actualGasUsed = parseInt(rawTx.gasUsed);
          
          if (!tenderlyCallTrace.status) {
            console.log(`      ⚠️  WARNING: Status mismatch with on-chain`);
          }
          
          if (tenderlyGasUsed > 0 && actualGasUsed > 0) {
            const gasDiff = Math.abs(tenderlyGasUsed - actualGasUsed);
            const gasDiffPercent = (gasDiff / actualGasUsed) * 100;
            
            if (gasDiffPercent > 10) {
              console.log(`      ⚠️  Gas mismatch: ${gasDiffPercent.toFixed(1)}%`);
            }
          }
          
          // 转换为内部交易格式（用于向后兼容）
          const allCalls = tenderlyCallTrace.trace[0] 
            ? extractAllCallsFromTrace(tenderlyCallTrace.trace[0])
            : [];
          tenderlyInternalTxs = allCalls.map(call => ({
            from: call.from,
            to: call.to,
            value: call.value || '0',
            type: call.type,
            gas: call.gas,
            gasUsed: call.gasUsed,
            input: call.input,
            output: call.output,
            error: call.error,
            function: call.function,
            decodedInput: call.decodedInput,
            decodedOutput: call.decodedOutput,
          }));
          console.log(`   ✅ Extracted ${tenderlyInternalTxs.length} calls from Tenderly`);
        }
        getProgress()?.({ type: 'tenderly_done', payload: { hasTrace: !!(tenderlyCallTrace?.trace) } });
      } catch (error) {
        console.log(`   ⚠️  [Tenderly] Trace failed: ${error}`);
        getProgress()?.({ type: 'tenderly_done', payload: { hasTrace: false } });
      }
    } else {
      if (!config.tenderlyRpcUrl) {
        console.log('   ℹ️  [Tenderly] Skipped: TENDERLY_RPC_URL not configured');
      } else if (!config.useTenderlySimulation) {
        console.log('   ℹ️  [Tenderly] Skipped: USE_TENDERLY_SIMULATION=false');
      }
      getProgress()?.({ type: 'tenderly_done', payload: { hasTrace: false } });
    }
    
    // 数据源 2: Etherscan Internal Transactions（ETH 流转）
    console.log('   📡 [Etherscan] Fetching internal txs (ETH flows)...');
    const etherscanInternalTxs = await getInternalTransactions(txHash);
    console.log(`   ✅ Got ${etherscanInternalTxs.length} internal txs from Etherscan`);
    getProgress()?.({
      type: 'etherscan_done',
      payload: { abi: !!(contractABI && contractABI.length > 0), internalTxCount: etherscanInternalTxs.length },
    });

    const internalTxs = tenderlyInternalTxs.length > 0 ? tenderlyInternalTxs : etherscanInternalTxs;
    const gasPrice = await getGasPriceAtBlock(rawTx.blockNumber);
    
    // 输出获取结果
    console.log('   ✓ Data fetched:');
    console.log(`      Contract ABI: ${contractABI ? `${contractABI.length} entries` : 'N/A'}`);
    console.log(`      Contract Source: ${contractSource ? 'Available' : 'N/A'}`);
    console.log(`      Decoded Function: ${decodedFunction ? decodedFunction.functionName : 'N/A'}`);
    console.log(`      From Label: ${fromLabel || 'N/A'}`);
    console.log(`      To Label: ${toLabel || 'N/A'}`);
    console.log(`      Internal Txs: ${internalTxs.length}`);
    console.log(`      Gas Price: ${gasPrice?.gasPrice || 'N/A'} Gwei`);
    
    // 构建地址标签映射
    const addressLabels: Record<string, string> = {};
    if (fromLabel) addressLabels[rawTx.from] = fromLabel;
    if (toLabel && rawTx.to) addressLabels[rawTx.to] = toLabel;
    
    // 获取代币信息（先尝试 RPC，失败后再用 Etherscan）
    const uniqueTokens = [...new Set(tokenFlows.map(f => f.token))];
    console.log(`   🪙 Fetching info for ${uniqueTokens.length} unique tokens...`);
    
    const tokenInfoResults = await Promise.all(
      uniqueTokens.slice(0, 5).map(async (token) => {
        // 先尝试通过 RPC 获取（快速，不占用 API 配额）
        console.log(`      [Token] Trying RPC for ${token.slice(0, 10)}...`);
        const rpcInfo = await getTokenInfoFromRPC(token);
        
        if (rpcInfo && (rpcInfo.name || rpcInfo.symbol)) {
          console.log(`      [Token] ✓ Got from RPC: ${rpcInfo.symbol || 'Unknown'}`);
          return { 
            token, 
            info: {
              name: rpcInfo.name,
              symbol: rpcInfo.symbol,
              decimals: rpcInfo.decimals?.toString() || '18',
              totalSupply: null,
            }
          };
        }
        
        // RPC 失败，尝试 Etherscan（更慢，占用配额）
        console.log(`      [Token] Trying Etherscan for ${token.slice(0, 10)}...`);
        const etherscanInfo = await getTokenInfo(token);
        return { token, info: etherscanInfo };
      })
    );
    
    // 增强 tokenFlows 信息
    const enrichedTokenFlows = tokenFlows.map(flow => {
      const tokenInfo = tokenInfoResults.find(r => r.token === flow.token)?.info;
      return {
        ...flow,
        symbol: tokenInfo?.symbol || undefined,
        name: tokenInfo?.name || undefined,
        decimals: tokenInfo?.decimals || undefined,
      };
    });
    
    // 分析 Gas 价格上下文（修复：使用 Number 避免 BigInt 截断）
    const txGasPriceGwei = Number(rawTx.gasPrice) / 1e9; // 转为 Gwei (number)
    const currentGasPriceGwei = gasPrice?.gasPrice ? parseFloat(gasPrice.gasPrice) : 0;
    const gasContext = {
      currentPrice: gasPrice?.gasPrice || 'unknown',
      baseFee: gasPrice?.baseFee || 'unknown',
      isAbnormal: currentGasPriceGwei > 0 && 
        (txGasPriceGwei > currentGasPriceGwei * 3 || txGasPriceGwei < 0.001),
    };
    
    // 输出详细信息
    console.log('\n📊 [Extract] Transaction Details:');
    console.log('─'.repeat(60));
    console.log(`   Block Number: ${rawTx.blockNumber}`);
    
    // 显示地址和标签
    const fromDisplay = addressLabels[rawTx.from] 
      ? `${rawTx.from} [${addressLabels[rawTx.from]}]`
      : rawTx.from;
    console.log(`   From: ${fromDisplay}`);
    
    if (rawTx.to) {
      const toDisplay = addressLabels[rawTx.to]
        ? `${rawTx.to} [${addressLabels[rawTx.to]}]`
        : rawTx.to;
      console.log(`   To: ${toDisplay}`);
    } else {
      console.log(`   To: (Contract Creation)`);
    }
    
    console.log(`   Value: ${(Number(rawTx.value) / 1e18).toFixed(6)} ETH`);
    console.log(`   Gas Used: ${rawTx.gasUsed}`);
    
    // 正确计算 Gas Price（避免 BigInt 截断）
    const gasPriceGwei = Number(rawTx.gasPrice) / 1e9;
    console.log(`   Gas Price: ${gasPriceGwei.toFixed(9)} Gwei${gasContext.isAbnormal ? ' ⚠️  异常' : ''}`);
    
    // 计算交易费用（使用 Number 以保持精度）
    const txFeeEth = (Number(rawTx.gasUsed) * Number(rawTx.gasPrice)) / 1e18;
    console.log(`   Transaction Fee: ${txFeeEth.toFixed(10)} ETH`);
    
    // 显示 Gas 价格上下文
    if (gasContext.currentPrice !== 'unknown') {
      console.log(`   Current Gas Price: ${gasContext.currentPrice} Gwei (reference)`);
    }
    
    // 显示函数调用信息
    if (decodedFunction) {
      console.log(`\n   📞 Function Call (Decoded with ABI):`);
      console.log(`      Function: ${decodedFunction.functionName}`);
      // 使用自定义序列化以支持 BigInt
      const argsStr = JSON.stringify(
        decodedFunction.args, 
        (_key, value) => typeof value === 'bigint' ? value.toString() : value,
        2
      ).slice(0, 500);
      console.log(`      Arguments: ${argsStr}`);
    } else if (decodedInput.functionSelector !== '0x') {
      console.log(`\n   📞 Function Call (Basic):`);
      console.log(`      Selector: ${decodedInput.functionSelector}`);
      if (decodedInput.functionSignature) {
        console.log(`      Function: ${decodedInput.functionSignature}`);
      } else {
        console.log(`      Function: Unknown (selector not in database)`);
      }
      console.log(`      Input Data Length: ${rawTx.input.length} chars`);
    }
    
    // 显示内部交易
    if (internalTxs.length > 0) {
      console.log(`\n   🔄 Internal Transactions: ${internalTxs.length}`);
      console.log('   ┌─ Internal Call Details:');
      internalTxs.slice(0, 3).forEach((itx: any, i: number) => {
        const value = BigInt(itx.value || '0') / 10n**15n / 1000n; // to ETH
        console.log(`   │  ${i + 1}. ${itx.type || 'call'}: ${itx.from.slice(0, 10)}... → ${itx.to.slice(0, 10)}...`);
        console.log(`   │     Value: ${value.toString()} ETH`);
      });
      if (internalTxs.length > 3) {
        console.log(`   └─ ... and ${internalTxs.length - 3} more internal calls`);
      } else {
        console.log(`   └─`);
      }
    }
    
    console.log(`\n   💎 Token Transfers: ${enrichedTokenFlows.length}`);
    if (enrichedTokenFlows.length > 0) {
      console.log('   ┌─ Token Flow Details:');
      enrichedTokenFlows.slice(0, 5).forEach((flow, i) => {
        const tokenDisplay = flow.symbol 
          ? `${flow.symbol} (${flow.name || 'Unknown'})`
          : flow.token;
        console.log(`   │  ${i + 1}. ${tokenDisplay}`);
        console.log(`   │     From: ${flow.from.slice(0, 10)}...`);
        console.log(`   │     To:   ${flow.to.slice(0, 10)}...`);
        
        // 输出原始数据（调试用）
        console.log(`   │     Amount (raw): ${flow.amount}`);
        console.log(`   │     Decimals: ${flow.decimals || 'N/A'}`);
        
        if (flow.decimals) {
          // ✅ 使用 viem 的 formatUnits（专门处理区块链数值，不丢失精度）
          const amountFormatted = formatUnits(BigInt(flow.amount), Number(flow.decimals));
          console.log(`   │     Amount: ${amountFormatted} ${flow.symbol || ''}`);
        } else {
          console.log(`   │     Amount: ${flow.amount.slice(0, 20)}... (no decimals info)`);
        }
      });
      if (enrichedTokenFlows.length > 5) {
        console.log(`   └─ ... and ${enrichedTokenFlows.length - 5} more transfers`);
      } else {
        console.log(`   └─`);
      }
    }
    
    console.log('─'.repeat(60));
    console.log('✅ [Extract] Data extraction completed\n');
    
    // 构建 decoded calls 信息
    const decodedCalls: DecodedCall[] = [];
    if (rawTx.to) {
      if (decodedFunction) {
        // 使用 ABI 解码的结果（更详细）
        decodedCalls.push({
          contract: rawTx.to,
          functionName: decodedFunction.functionName,
          params: decodedFunction.args,
          value: rawTx.value,
        });
      } else if (decodedInput.functionSelector !== '0x') {
        // 回退到基础解码
        decodedCalls.push({
          contract: rawTx.to,
          functionName: decodedInput.functionSignature || decodedInput.functionSelector,
          params: {
            rawData: decodedInput.rawParams.slice(0, 200), // 只取前 200 字符
          },
          value: rawTx.value,
        });
      }
    }
    
    // 转换内部交易格式
    const formattedInternalTxs = internalTxs.map((itx: any) => ({
      from: itx.from,
      to: itx.to,
      value: itx.value || '0',
      type: itx.type || 'call',
      gas: itx.gas,
      gasUsed: itx.gasUsed,
      isError: itx.isError,
    }));
    
    return {
      rawTx,
      tokenFlows: enrichedTokenFlows,
      decodedCalls,
      // 两个数据源都保留
      etherscanInternalTxs: formattedInternalTxs,
      tenderlyCallTrace,
      internalTxs: formattedInternalTxs, // 统一视图（向后兼容）
      addressLabels,
      contractABI,
      contractSource,
      gasContext,
    };
  } catch (error) {
    console.error('❌ [Extract] Error:', error);
    return {
      error: `Failed to extract transaction data: ${error}`,
    };
  }
}

/**
 * Node 2: Draft - 使用 LLM 生成解释
 */
export async function draftNode(state: AnalysisState): Promise<Partial<AnalysisState>> {
  if (state.error || !state.rawTx) {
    return { error: state.error || 'No transaction data available' };
  }
  getProgress()?.({ type: 'draft_start' });

  try {
    const { llmConfig } = await import('../config/index.js');
    console.log('✍️  [Draft] Generating explanation...');
    console.log(`   Provider: ${llmConfig.provider}`);
    console.log(`   Model: ${llmConfig.model}`);
    
    let llm;
    if (llmConfig.provider === 'openrouter') {
      // 使用 OpenRouter (兼容 OpenAI API 格式)
      llm = new ChatOpenAI({
        apiKey: config.anthropicApiKey,  // OpenRouter API Key
        model: llmConfig.model,
        temperature: 0.3,
        maxRetries: 3,  // 设置重试次数
        timeout: 60000, // 60秒超时
        configuration: {
          baseURL: llmConfig.baseURL,
          defaultHeaders: {
            // 'HTTP-Referer': 'https://github.com/mevagent',
            'X-Title': 'MEV Agent',
          },
        },
        callbacks: [{
          handleLLMStart: async () => {
            console.log('   🔄 Calling LLM API...');
          },
          handleLLMEnd: async () => {
            console.log('   ✓ Response received');
          },
          handleLLMError: async (error: Error) => {
            console.log(`   ⚠️  LLM Error: ${error.message}`);
            console.log('   🔄 Retrying...');
          },
        }],
      });
    } else {
      // 使用 Anthropic 官方 API
      llm = new ChatAnthropic({
        apiKey: config.anthropicApiKey,
        model: llmConfig.model,
        temperature: 0.3,
        maxRetries: 3,
        callbacks: [{
          handleLLMStart: async () => {
            console.log('   🔄 Calling Anthropic API...');
          },
          handleLLMEnd: async () => {
            console.log('   ✓ Response received');
          },
          handleLLMError: async (error: Error) => {
            console.log(`   ⚠️  API Error: ${error.message}`);
            console.log('   🔄 Retrying...');
          },
        }],
      });
    }
    
    // 简单的 MEV 模式识别
    const mevPattern = identifyMEVPattern(state.rawTx, state.tokenFlows || []);
    console.log(`   Detected pattern: ${mevPattern.type} (${(mevPattern.confidence * 100).toFixed(0)}%)`);
    
    // 构建 prompt
    const prompt = buildAnalysisPrompt(state, mevPattern);
    console.log(`   Prompt length: ${prompt.length} chars`);
    
    // 调用 LLM
    console.log('   ⏳ Waiting for response (this may take 10-30s)...');
    const response = await llm.invoke(prompt);
    const draftExplanation = response.content.toString();
    getProgress()?.({ type: 'draft_done' });
    console.log('✅ [Draft] Explanation generated successfully!');
    console.log(`   Response length: ${draftExplanation.length} chars`);
    
    return {
      draftExplanation,
    };
  } catch (error) {
    console.error('❌ [Draft] Error:', error);
    return {
      error: `Failed to generate explanation: ${error}`,
    };
  }
}

export async function outputNode(state: AnalysisState): Promise<Partial<AnalysisState>> {
  console.log('📄 [Output] Formatting final report...');

  if (state.error) {
    const errorReport = {
      summary: `Error: ${state.error}`,
      mevType: 'unknown' as const,
      steps: [],
      tokenFlows: [],
      technicalDetails: {},
    };
    getProgress()?.({ type: 'done', payload: { report: errorReport } });
    return { finalReport: errorReport };
  }
  
  const mevPattern = identifyMEVPattern(
    state.rawTx!,
    state.tokenFlows || []
  );
  
  const finalReport = {
    summary: state.draftExplanation || 'No explanation generated',
    mevType: mevPattern.type,
    steps: extractSteps(state.draftExplanation || ''),
    tokenFlows: state.tokenFlows || [],
    technicalDetails: {
      txHash: state.txHash,
      blockNumber: state.rawTx?.blockNumber,
      gasUsed: state.rawTx?.gasUsed,
      from: state.rawTx?.from,
      to: state.rawTx?.to,
      mevConfidence: mevPattern.confidence,
    },
    tenderlyCallTrace: state.tenderlyCallTrace,
    etherscanInternalTxs: state.etherscanInternalTxs,
  };
  getProgress()?.({ type: 'done', payload: { report: finalReport } });
  return { finalReport };
}

/**
 * 辅助函数: 构建分析 prompt（增强版 v2）
 */
function buildAnalysisPrompt(state: AnalysisState, mevPattern: any): string {
  const tx = state.rawTx!;
  const flows = state.tokenFlows || [];
  const calls = state.decodedCalls || [];
  const internalTxs = state.internalTxs || [];
  const addressLabels = state.addressLabels || {};
  const gasContext = state.gasContext;
  
  // 获取两个数据源
  const etherscanInternalTxs = state.etherscanInternalTxs || [];
  const tenderlyCallTrace = state.tenderlyCallTrace;
  
  // Build function call information
  let functionCallInfo = 'No function call (simple transfer)';
  if (calls.length > 0) {
    const call = calls[0];
    const contractLabel = addressLabels[call.contract] || '';
    functionCallInfo = `Called function: ${call.functionName}`;
    if (contractLabel) {
      functionCallInfo += `\nContract: ${contractLabel}`;
    }
    if (call.args) {
      // ABI decoded parameters (BigInt safe)
      const argsStr = JSON.stringify(
        call.args,
        (_key, value) => typeof value === 'bigint' ? value.toString() : value
      ).slice(0, 200);
      functionCallInfo += `\nParameters: ${argsStr}...`;
    } else if (call.params?.rawData) {
      // Raw parameter data
      functionCallInfo += `\nRaw data: 0x${call.params.rawData.slice(0, 100)}...`;
    }
  }
  
  // Build token flow details (with token names, analyze inputs/outputs)
  let tokenFlowDetails = 'No token transfers';
  let tokenFlowSummary = '';
  
  if (flows.length > 0) {
    // Analyze token inflows and outflows
    const flowsIn = flows.filter(f => f.to.toLowerCase() === tx.from.toLowerCase());
    const flowsOut = flows.filter(f => f.from.toLowerCase() === tx.from.toLowerCase());
    
    if (flowsIn.length > 0 || flowsOut.length > 0) {
      tokenFlowSummary = '\n**Token Exchange Summary**:\n';
      
      if (flowsOut.length > 0) {
        tokenFlowSummary += '📤 Sent/Output:\n';
        flowsOut.forEach(f => {
          const tokenInfo = f.symbol || f.token.slice(0, 10);
          const amount = f.decimals 
            ? formatUnits(BigInt(f.amount), Number(f.decimals))
            : 'Unknown';
          tokenFlowSummary += `  - ${amount} ${tokenInfo}\n`;
        });
      }
      
      if (flowsIn.length > 0) {
        tokenFlowSummary += '📥 Received/Input:\n';
        flowsIn.forEach(f => {
          const tokenInfo = f.symbol || f.token.slice(0, 10);
          const amount = f.decimals 
            ? formatUnits(BigInt(f.amount), Number(f.decimals))
            : 'Unknown';
          tokenFlowSummary += `  - ${amount} ${tokenInfo}\n`;
        });
      }
      
      tokenFlowSummary += '\n';
    }
    
    tokenFlowDetails = tokenFlowSummary + flows.slice(0, 8).map((f, i) => {
      const tokenInfo = f.symbol ? `${f.symbol} (${f.name || 'Unknown Token'})` : f.token;
      let amountDisplay = f.amount;
      if (f.decimals) {
        const readableAmount = formatUnits(BigInt(f.amount), Number(f.decimals));
        amountDisplay = `${readableAmount} ${f.symbol || ''}`;
      } else {
        amountDisplay = `${f.amount.slice(0, 30)}... (wei)`;
      }
      return `${i + 1}. Token: ${tokenInfo}
   From: ${f.from}${addressLabels[f.from] ? ` [${addressLabels[f.from]}]` : ''}
   To: ${f.to}${addressLabels[f.to] ? ` [${addressLabels[f.to]}]` : ''}
   Amount: ${amountDisplay}
   Direction: ${f.from.toLowerCase() === tx.from.toLowerCase() ? '🔴 Outbound' : f.to.toLowerCase() === tx.from.toLowerCase() ? '🟢 Inbound' : '🔵 Other'}`;
    }).join('\n\n');
    
    if (flows.length > 8) {
      tokenFlowDetails += `\n\n... and ${flows.length - 8} more token transfers`;
    }
  }
  
  // Build internal transaction details
  let internalTxDetails = 'No internal calls';
  if (internalTxs.length > 0) {
    internalTxDetails = `Total ${internalTxs.length} internal calls:\n`;
    internalTxDetails += internalTxs.slice(0, 5).map((itx, i) => {
      const value = (Number(itx.value) / 1e18).toFixed(6);
      return `${i + 1}. ${itx.type}: ${itx.from.slice(0, 10)}... → ${itx.to.slice(0, 10)}... (${value} ETH)`;
    }).join('\n');
    if (internalTxs.length > 5) {
      internalTxDetails += `\n... and ${internalTxs.length - 5} more internal calls`;
    }
  }
  
  // 计算实际转账的 ETH 金额
  const ethValue = (BigInt(tx.value) / 10n**15n) / 1000n; // 转换为 ETH，保留 3 位小数
  const txFee = (BigInt(tx.gasUsed) * BigInt(tx.gasPrice)) / 10n**18n;
  
  // Gas 价格分析
  const txGasPriceGwei = (Number(tx.gasPrice) / 1e9).toFixed(9);
  const gasAnalysis = gasContext ? `
- 交易 Gas 价格: ${txGasPriceGwei} Gwei
- 当前参考价格: ${gasContext.currentPrice} Gwei
- 是否异常: ${gasContext.isAbnormal ? '是 ⚠️ (过高或异常低)' : '否'}
` : '';
  
  // 构建地址标签信息
  const fromLabel = addressLabels[tx.from] ? `[${addressLabels[tx.from]}]` : '';
  const toLabel = tx.to && addressLabels[tx.to] ? `[${addressLabels[tx.to]}]` : '';
  
  return `You are a professional blockchain transaction analyst. Analyze this Ethereum transaction in detail.

⚠️ **Important**: 
- If "ETH Transfer Amount" is 0, focus on token transfers!
- Many transactions swap Token A for Token B without ETH transfer
- Carefully analyze token inputs and outputs to understand the actual exchange

# Basic Transaction Information
- **Transaction Hash**: ${state.txHash}
- **Block Number**: ${tx.blockNumber}
- **From**: ${tx.from} ${fromLabel}
- **To**: ${tx.to || '(Contract Creation)'} ${toLabel}
- **ETH Transfer**: ${ethValue.toString()} ETH ${ethValue.toString() === '0' ? '(⚠️ 0 ETH doesn\'t mean no value transfer - check token transfers!)' : ''}
- **Gas Used**: ${tx.gasUsed} gas
- **Gas Price**: ${txGasPriceGwei} Gwei
- **Transaction Fee**: ${txFee.toString()} ETH

# Gas Price Analysis
${gasAnalysis}

# Function Call Analysis
${functionCallInfo}

# Internal Transactions (${internalTxs.length} total)
${internalTxDetails}

# Token Transfers (${flows.length} total)
${tokenFlowDetails}

# Transaction Input Data
- Input length: ${tx.input.length} characters
- First 100 chars: ${tx.input.slice(0, 100)}${tx.input.length > 100 ? '...' : ''}

# MEV 模式识别结果
- **检测类型**: ${mevPattern.type}
- **置信度**: ${(mevPattern.confidence * 100).toFixed(0)}%
- **详细信息**: ${JSON.stringify(
    mevPattern.details,
    (_key, value) => typeof value === 'bigint' ? value.toString() : value,
    2
  )}

# 结构化数据（供深度分析）

⚠️ **重要**: 以下是原始的结构化数据，请仔细分析它们来理解交易的完整执行过程

## Etherscan Internal Transactions (ETH 流转视图)
说明：这是 Etherscan 提供的简化视图，只显示涉及 ETH 转账的内部调用
数量：${etherscanInternalTxs.length} 笔
${etherscanInternalTxs.length > 0 ? `
数据：
\`\`\`json
${JSON.stringify(
  etherscanInternalTxs.slice(0, 10).map(itx => ({
    type: itx.type,
    from: itx.from,
    to: itx.to,
    value: itx.value,
    gasUsed: itx.gasUsed,
    isError: itx.isError,
  })),
  (_key, value) => typeof value === 'bigint' ? value.toString() : value,
  2
)}
${etherscanInternalTxs.length > 10 ? `\n... 还有 ${etherscanInternalTxs.length - 10} 笔（已省略）` : ''}
\`\`\`
` : '无数据'}

## Tenderly Call Trace (完整调用轨迹)
说明：这是完整的交易执行轨迹，包含所有合约调用（CALL/DELEGATECALL/STATICCALL等）
状态：${tenderlyCallTrace ? '✅ 可用' : '❌ 不可用'}
${tenderlyCallTrace ? `
调用深度：递归嵌套（请注意 calls 字段中的子调用）
完整数据：
\`\`\`json
${JSON.stringify(
  {
    gasUsed: tenderlyCallTrace.gasUsed,
    status: tenderlyCallTrace.status,
    trace: tenderlyCallTrace.trace, // 完整的调用树
  },
  (_key, value) => typeof value === 'bigint' ? value.toString() : value,
  2
).slice(0, 5000)}
${JSON.stringify(tenderlyCallTrace).length > 5000 ? '\n... (数据太大已截断，但你已经看到了主要结构)' : ''}
\`\`\`

**如何理解 Tenderly Trace**:
- trace 是一个递归结构，每个调用可能包含 calls 数组（子调用）
- type 字段表示调用类型：CALL（普通调用）/ DELEGATECALL（代理）/ STATICCALL（只读）
- input 字段包含函数调用数据（前4字节是函数选择器）
- value 字段表示转账的 ETH 数量
- error 字段表示调用是否失败
` : '（未配置 Tenderly 或获取失败）'}

# Analysis Task

Analyze this Ethereum transaction in depth.

**Core Requirements**:

1. **Deep Analysis of Call Trace** (if provided)
   - Use trace data to definitively identify contracts, functions, and outcomes
   - Identify contract types (Router, Pool, Token, etc.) based on trace
   - Make **definitive conclusions**, avoid "might be" or "possibly"

2. **Accurate Token Flow Understanding**
   - Focus on token transfers, don't be misled by "ETH Transfer: 0"
   - Combine Call Trace and Token Flows to understand the complete path
   - Clearly state: User sent X tokens → received Y tokens

3. **Avoid Vague Language**
   - ❌ Forbidden: "might be", "possibly", "perhaps", "guess", "probably"
   - ✅ Correct: "call trace shows", "token transfer indicates", "this is XX contract (address 0x...)"
   - If insufficient data, say "insufficient data"

4. **Natural Style**
   - Like telling a story: conclusion first, then evidence
   - Don't rigidly follow fixed format
   - Accurate technical details, accessible explanations

Begin your analysis!`;
}

function extractSteps(explanation: string): string[] {
  const lines = explanation.split('\n');
  const steps: string[] = [];
  
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      steps.push(match[1]);
    }
  }
  
  return steps;
}
