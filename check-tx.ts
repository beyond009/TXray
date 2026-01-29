import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
});

const txHash = '0xa058d31d079e462452673875876e777fe0b79add0203f269cb5a7bc0e0dce6b6';

async function checkTx() {
  const tx = await client.getTransaction({ hash: txHash as any });
  const receipt = await client.getTransactionReceipt({ hash: txHash as any });
  
  console.log('\n📊 Transaction Details:');
  console.log('─'.repeat(60));
  console.log(`Block: ${tx.blockNumber}`);
  console.log(`From: ${tx.from}`);
  console.log(`To: ${tx.to}`);
  console.log(`Value: ${tx.value} wei (${Number(tx.value) / 1e18} ETH)`);
  console.log(`Gas Limit: ${tx.gas}`);
  console.log(`Gas Used: ${receipt.gasUsed}`);
  console.log(`Gas Price: ${tx.gasPrice} wei (${Number(tx.gasPrice) / 1e9} Gwei)`);
  console.log(`Max Fee Per Gas: ${tx.maxFeePerGas || 'N/A'}`);
  console.log(`Max Priority Fee: ${tx.maxPriorityFeePerGas || 'N/A'}`);
  console.log(`Type: ${tx.type}`);
  console.log(`Status: ${receipt.status === 'success' ? '✅ Success' : '❌ Failed'}`);
  console.log(`Transaction Fee: ${Number(receipt.gasUsed) * Number(tx.gasPrice) / 1e18} ETH`);
  console.log('\n🔍 Why Gas Price = 0?');
  console.log('Possible reasons:');
  console.log('  1. Type 2 (EIP-1559) transaction with 0 base fee');
  console.log('  2. Miner/validator self-transaction');
  console.log('  3. Flashbots or private transaction bundle');
  console.log('  4. Network testing or special governance transaction');
}

checkTx().catch(console.error);
