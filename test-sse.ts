/**
 * 测试脚本：发送请求并打印所有 SSE 事件
 */

const txHash = '0x91dd8404738a615fb2ddd65b0423a41753472cb6d2519092f865e2d22f8843a8';

async function testSSE() {
  console.log('🧪 Testing SSE events for:', txHash);
  console.log('');
  
  const response = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: txHash }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const block of lines) {
      const eventLines = block.split('\n');
      let eventType = 'message';
      let data: any = null;

      for (const line of eventLines) {
        if (line.startsWith('event: ')) {
          eventType = line.replace('event: ', '').trim();
        } else if (line.startsWith('data: ')) {
          try {
            data = JSON.parse(line.replace('data: ', '').trim());
          } catch (e) {
            data = line.replace('data: ', '').trim();
          }
        }
      }

      if (eventType === 'tenderly_done') {
        console.log('🔍 ========== TENDERLY_DONE EVENT ==========');
        console.log('Event Type:', eventType);
        console.log('Data:', JSON.stringify(data, null, 2));
        console.log('hasTrace:', data?.payload?.hasTrace);
        console.log('==========================================\n');
      } else if (eventType !== 'draft_chunk') {
        console.log(`📡 ${eventType}:`, data?.type || data);
      }
    }
  }
}

testSSE().catch(console.error);
