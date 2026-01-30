#!/usr/bin/env node
import { analyzeTx } from './graph/workflow.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
MEV Transaction Analyzer

Usage:
  pnpm exec tsx src/cli.ts <transaction_hash>

Example:
  pnpm exec tsx src/cli.ts 0x1234567890abcdef...
`);
    process.exit(0);
  }

  const txHash = args[0];

  if (!txHash.startsWith('0x') || txHash.length !== 66) {
    console.error('Invalid tx hash. Expected 0x + 64 hex chars.');
    process.exit(1);
  }

  console.log(`\nAnalyzing: ${txHash}\n`);
  console.log('─'.repeat(60));

  try {
    const result = await analyzeTx(txHash);

    if (result.error) {
      console.error('Error:', result.error);
      process.exit(1);
    }

    if (result.finalReport && typeof result.finalReport === 'object') {
      const report = result.finalReport as {
        mevType: string;
        summary: string;
        tokenFlows: any[];
        technicalDetails: Record<string, any>;
        verification?: { passed: boolean; issues: string[] };
        tenderlySimulation?: any;
      };

      console.log('\n' + '='.repeat(60));
      console.log('\nAnalysis:\n');
      console.log(report.summary || '(no output)');
      console.log('\n' + '='.repeat(60));

      if (report.technicalDetails && Object.keys(report.technicalDetails).length > 0) {
        const td = report.technicalDetails;
        console.log('\nTechnical details:');
        console.log(`  Block: ${td.blockNumber ?? '-'}`);
        console.log(`  Gas used: ${td.gasUsed ?? '-'}`);
        console.log(`  Token transfers: ${report.tokenFlows?.length ?? 0}`);
      }

      if (report.verification && !report.verification.passed && report.verification.issues?.length) {
        console.log('\nVerification issues:');
        report.verification.issues.forEach((i: string) => console.log(`  - ${i}`));
      }

      if (report.tenderlySimulation) {
        console.log('\n' + '─'.repeat(60));
        console.log('\nTenderly trace:');
        console.log(`  Status: ${report.tenderlySimulation.status ? 'OK' : 'Failed'}`);
        console.log(`  Gas: ${report.tenderlySimulation.gasUsed}`);

        if (report.tenderlySimulation.trace) {
          const allCalls = extractAllCallsForDisplay(report.tenderlySimulation.trace);
          console.log(`\n  Calls (${allCalls.length}):`);
          allCalls.slice(0, 5).forEach((call: any, i: number) => {
            console.log(`    ${i + 1}. ${call.type}: ${call.from?.slice(0, 10)}... → ${call.to?.slice(0, 10)}...`);
            if (call.function_name) console.log(`       ${call.function_name}`);
          });
          if (allCalls.length > 5) console.log(`    ... and ${allCalls.length - 5} more`);
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
    console.error('\nFailed:', error);
    process.exit(1);
  }
}

main();
