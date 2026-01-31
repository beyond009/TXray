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
    const receiptPlain = receipt ? {
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber?.toString(),
      contractAddress: receipt.contractAddress,
      cumulativeGasUsed: receipt.cumulativeGasUsed?.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      from: receipt.from,
      gasUsed: receipt.gasUsed?.toString(),
      logs: receipt.logs,
      logsBloom: receipt.logsBloom,
      status: receipt.status,
      to: receipt.to,
      transactionHash: receipt.transactionHash,
      type: receipt.type,
    } : null;
    getProgress()?.({ type: 'rpc_done', payload: { rawTx, receipt: receiptPlain, tokenFlows } });

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
        getProgress()?.({
          type: 'tenderly_done',
          payload: { trace: tenderlyCallTrace, calls: tenderlyInternalTxs },
        });
      } catch (error) {
        console.log(`   ⚠️  [Tenderly] Trace failed: ${error}`);
        getProgress()?.({ type: 'tenderly_done', payload: { trace: null, calls: [] } });
      }
    } else {
      if (!config.tenderlyRpcUrl) {
        console.log('   ℹ️  [Tenderly] Skipped: TENDERLY_RPC_URL not configured');
      } else if (!config.useTenderlySimulation) {
        console.log('   ℹ️  [Tenderly] Skipped: USE_TENDERLY_SIMULATION=false');
      }
      getProgress()?.({ type: 'tenderly_done', payload: { trace: null, calls: [] } });
    }
    
    // 数据源 2: Etherscan Internal Transactions（ETH 流转）
    console.log('   📡 [Etherscan] Fetching internal txs (ETH flows)...');
    const etherscanInternalTxs = await getInternalTransactions(txHash);
    console.log(`   ✅ Got ${etherscanInternalTxs.length} internal txs from Etherscan`);

    const internalTxs = tenderlyInternalTxs.length > 0 ? tenderlyInternalTxs : etherscanInternalTxs;
    const gasPrice = await getGasPriceAtBlock(rawTx.blockNumber);

    const addressLabels: Record<string, string> = {};
    if (fromLabel) addressLabels[rawTx.from] = fromLabel;
    if (toLabel && rawTx.to) addressLabels[rawTx.to] = toLabel;

    const contractSourceForPayload = contractSource && contractSource.length > 100000
      ? contractSource.slice(0, 100000) + '\n/* ... truncated */'
      : contractSource;

    getProgress()?.({
      type: 'etherscan_done',
      payload: {
        contractABI,
        contractSource: contractSourceForPayload,
        decodedFunction: decodedFunction || null,
        addressLabels,
        internalTxs: etherscanInternalTxs,
        gasContext: gasPrice,
      },
    });
    
    // 输出获取结果
    console.log('   ✓ Data fetched:');
    console.log(`      Contract ABI: ${contractABI ? `${contractABI.length} entries` : 'N/A'}`);
    console.log(`      Contract Source: ${contractSource ? 'Available' : 'N/A'}`);
    console.log(`      Decoded Function: ${decodedFunction ? decodedFunction.functionName : 'N/A'}`);
    console.log(`      From Label: ${fromLabel || 'N/A'}`);
    console.log(`      To Label: ${toLabel || 'N/A'}`);
    console.log(`      Internal Txs: ${internalTxs.length}`);
    console.log(`      Gas Price: ${gasPrice?.gasPrice || 'N/A'} Gwei`);
    
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
    
    const decodedCalls: DecodedCall[] = [];
    if (rawTx.to) {
      if (decodedFunction) {
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
    const prompt = buildAnalysisPrompt(state);
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

function buildGroundTruth(state: AnalysisState): string {
  const tx = state.rawTx!;
  const flows = state.tokenFlows || [];
  const from = tx.from.toLowerCase();
  const sent = flows.filter((f) => f.from.toLowerCase() === from);
  const received = flows.filter((f) => f.to.toLowerCase() === from);
  const fmt = (f: { amount: string; symbol?: string; decimals?: string }) => {
    const amt = f.decimals ? formatUnits(BigInt(f.amount), Number(f.decimals)) : f.amount;
    return `${amt} ${f.symbol || 'tokens'}`;
  };
  const lines = [
    `Block: ${tx.blockNumber}`,
    `Gas used: ${tx.gasUsed}`,
    `From: ${tx.from}`,
    `To: ${tx.to || '(contract creation)'}`,
    `ETH value: ${(Number(tx.value) / 1e18).toFixed(6)}`,
    sent.length ? `Sent: ${sent.map(fmt).join(', ')}` : null,
    received.length ? `Received: ${received.map(fmt).join(', ')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export async function verifyNode(state: AnalysisState): Promise<Partial<AnalysisState>> {
  if (state.error || !state.draftExplanation || !state.rawTx) {
    return {};
  }
  if (config.enableVerification === false) {
    return { verificationResult: { passed: true, issues: [] } };
  }
  getProgress()?.({ type: 'verify_start' });
  console.log('🔎 [Verify] Fact-checking draft...');
  try {
    const groundTruth = buildGroundTruth(state);
    const { llmConfig } = await import('../config/index.js');
    const llm =
      llmConfig.provider === 'openrouter'
        ? new ChatOpenAI({
            apiKey: config.anthropicApiKey,
            model: llmConfig.model,
            temperature: 0,
            configuration: { baseURL: llmConfig.baseURL },
          })
        : new ChatAnthropic({
            apiKey: config.anthropicApiKey,
            model: llmConfig.model,
            temperature: 0,
          });
    const callTraceSection = state.callTraceExplanation
      ? `\nCall trace explanation (use for cross-check):\n${state.callTraceExplanation.slice(0, 2000)}\n`
      : '';

    const prompt = `Ground truth from on-chain data:
${groundTruth}
${callTraceSection}
Draft analysis to verify:
${state.draftExplanation.slice(0, 4000)}

Task: List any factual errors in the draft (wrong numbers, wrong addresses, wrong token flow). Also check if the draft contradicts the call trace explanation. Reply with "OK" if no errors. Otherwise list each error on a new line starting with "- ".`;
    const resp = await llm.invoke(prompt);
    const text = resp.content.toString().trim();
    const passed = text.toUpperCase().startsWith('OK') || text.toLowerCase().includes('no error');
    const issues = passed ? [] : text.split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.replace(/^-\s*/, '').trim());
    if (issues.length) console.log(`   ⚠️  Issues: ${issues.length}`);
    else console.log('   ✓ Passed');
    getProgress()?.({ type: 'verify_done', payload: { passed, issuesCount: issues.length } });
    return { verificationResult: { passed, issues } };
  } catch (err) {
    console.warn('   Verify failed:', err);
    return { verificationResult: { passed: true, issues: [] } };
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
    verification: state.verificationResult,
    callTraceExplanation: state.callTraceExplanation,
    tenderlyCallTrace: state.tenderlyCallTrace,
    etherscanInternalTxs: state.etherscanInternalTxs,
  };
  getProgress()?.({ type: 'done', payload: { report: finalReport } });
  return { finalReport };
}

function buildAnalysisPrompt(state: AnalysisState): string {
  const tx = state.rawTx!;
  const flows = state.tokenFlows || [];
  const calls = state.decodedCalls || [];
  const internalTxs = state.internalTxs || [];
  const addressLabels = state.addressLabels || {};
  const gasContext = state.gasContext;
  
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
  
  let tokenFlowDetails = 'No token transfers';
  let tokenFlowSummary = '';
  
  if (flows.length > 0) {
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
    
    tokenFlowDetails = tokenFlowSummary + flows.slice(0, 25).map((f, i) => {
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
    
    if (flows.length > 25) {
      tokenFlowDetails += `\n\n... and ${flows.length - 25} more token transfers`;
    }
  }
  
  let internalTxDetails = 'No internal calls';
  if (internalTxs.length > 0) {
    internalTxDetails = `Total ${internalTxs.length} internal calls:\n`;
    internalTxDetails += internalTxs.slice(0, 15).map((itx, i) => {
      const value = (Number(itx.value) / 1e18).toFixed(6);
      return `${i + 1}. ${itx.type}: ${itx.from.slice(0, 10)}... → ${itx.to.slice(0, 10)}... (${value} ETH)`;
    }).join('\n');
    if (internalTxs.length > 15) {
      internalTxDetails += `\n... and ${internalTxs.length - 15} more internal calls`;
    }
  }
  
  const ethValue = (BigInt(tx.value) / 10n**15n) / 1000n;
  const txFee = (BigInt(tx.gasUsed) * BigInt(tx.gasPrice)) / 10n**18n;
  
  const txGasPriceGwei = (Number(tx.gasPrice) / 1e9).toFixed(9);
  const gasAnalysis = gasContext ? `
- Tx Gas Price: ${txGasPriceGwei} Gwei
- Reference Price: ${gasContext.currentPrice} Gwei
- Abnormal: ${gasContext.isAbnormal ? 'Yes ⚠️ (too high or unusually low)' : 'No'}
` : '';
  
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

# Structured Data (for deep analysis)

⚠️ **Important**: Below is the raw structured data. Analyze it to understand the complete execution.

## Etherscan Internal Transactions (ETH Flow View)
Description: Simplified view from Etherscan, showing only internal calls with ETH transfers.
Count: ${etherscanInternalTxs.length}
${etherscanInternalTxs.length > 0 ? `
Data:
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
${etherscanInternalTxs.length > 10 ? `\n... and ${etherscanInternalTxs.length - 10} more (omitted)` : ''}
\`\`\`
` : 'No data'}

## Tenderly Call Trace (Complete Execution Trace)
Description: Full transaction execution trace with all contract calls (CALL/DELEGATECALL/STATICCALL).
Status: ${tenderlyCallTrace ? '✅ Available' : '❌ Not available'}
${tenderlyCallTrace ? `
Structure: Recursive (note the calls array for sub-calls).
Raw data:
\`\`\`json
${JSON.stringify(
  {
    gasUsed: tenderlyCallTrace.gasUsed,
    status: tenderlyCallTrace.status,
    trace: tenderlyCallTrace.trace,
  },
  (_key, value) => typeof value === 'bigint' ? value.toString() : value,
  2
).slice(0, 5000)}
${JSON.stringify(tenderlyCallTrace).length > 5000 ? '\n... (truncated, main structure shown)' : ''}
\`\`\`

**How to read Tenderly Trace**:
- trace: recursive structure; each call may have a calls array (sub-calls)
- type: CALL (normal) / DELEGATECALL (proxy) / STATICCALL (read-only)
- input: function call data (first 4 bytes = selector)
- value: ETH amount transferred
- error: whether the call failed
` : '(Tenderly not configured or fetch failed)'}

# Call Trace Explanation (Step-by-Step)
${state.callTraceExplanation ? `
The following is a dedicated step-by-step explanation of the call trace. Use it to inform your analysis and ensure consistency.
\`\`\`
${state.callTraceExplanation}
\`\`\`
` : '(No call trace explanation available)'}

# Analysis Task

Analyze this Ethereum transaction in depth. Your summary should align with the Call Trace Explanation above. Cross-check: token flows, swap paths, and protocol roles must match.

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

**For MEV/Arbitrage Transactions** (when many token transfers, swaps across multiple protocols):

5. **Complete Swap Path** – Do NOT skip or summarize. Trace every hop:
   - List each swap: "Hop 1: Sent X token to Pool A (0x.../label) → received Y token"
   - Hop 2, 3, 4... until the final output
   - Include pool/protocol names (Uniswap V3, Curve 3pool, Compound, etc.)

6. **Profit Mechanism** – Explain how profit was made:
   - What did the executor (tx.from or main contract) put in initially?
   - What did they get out at the end?
   - Net result: e.g. "Spent 101 WETH, received 906 WETH → ~805 WETH profit"
   - What arbitrage opportunity was exploited? (e.g. price gap between Uniswap and Curve, flash loan + multi-hop swap)

7. **Do NOT summarize** – For complex multi-hop swaps, list each step. Do not write "swapped through multiple Curve pools" without naming each pool and the tokens at each hop.

8. **Mathematical / Quantitative Analysis** – For arbitrage, provide:
   - **Implied rates at each hop**: e.g. "Hop 1: 1 WETH ≈ 1,386 USDC (141,123 / 101.85)"
   - **Price discrepancy**: Compare the same asset pair across different pools. E.g. "Uniswap WETH/USDC: 1,386; Curve tricrypto USDT/WETH implies 1 WETH ≈ 1,420 USDT → arbitrage opportunity"
   - **Net PnL**: Total input vs output in a common unit. E.g. "Own capital: 101 WETH. Flash loan: 1.29M USDC (repaid in-tx). Output: 906 WETH. Net profit ≈ 905 WETH (minus gas)."
   - **Why the math works**: Explain the arbitrage in numbers. E.g. "Bought USDC cheap on Uniswap (1,386/ETH), sold USDT expensive on Curve (1,420/ETH), capturing the spread per unit × volume"

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
