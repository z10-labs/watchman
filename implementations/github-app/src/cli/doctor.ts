/**
 * `watchman doctor` — run the production preflight against a working copy.
 *
 * Same code, same rules, same refusals as the hosted reviewer; only the source
 * of the documents differs. The point is that a broken rubric is found by the
 * person who broke it, in the second it takes to run this, rather than four days
 * later by someone reading a verdict that turned out to be backed by nothing.
 */
import { fileDocSource } from '../github/doc-source';
import { preflight } from '../preflight/index';

const out = (line = '') => process.stdout.write(`${line}\n`);

export async function doctor(root: string): Promise<number> {
  const source = fileDocSource(root);
  out(`watchman doctor — ${source.describe}`);
  out();

  const result = await preflight(source);

  if (!result.ok) {
    out('REFUSED. This repository cannot be reviewed as configured:');
    out();
    for (const problem of result.problems) out(`  ✗ ${problem}`);
    out();
    out('No verdict would be produced for a pull request here — by design.');
    return 1;
  }

  out('READY.');
  out();
  out(`  rubric        ${result.config.rubric} (sha ${result.receipt.rubricSha})`);
  out(`  gate          ${result.config.gate.mode}, max ${result.config.gate.max_diff_lines} lines`);
  out(`  documents     ${result.receipt.documentsRead.length}`);
  for (const path of result.receipt.documentsRead) out(`                ${path}`);
  out(`  decisions     ${result.receipt.decisionCount}`);

  if (result.receipt.decisionCount === 0) {
    out();
    out('  Note: the decisions ledger is empty. Findings will have less to cite,');
    out('  and "does this contradict a resolved decision?" cannot be answered yet.');
  }

  return 0;
}

// Only run when invoked directly, so the function stays importable by tests.
if (process.argv[1]?.endsWith('doctor.ts') || process.argv[1]?.endsWith('doctor.js')) {
  const code = await doctor(process.argv[2] ?? process.cwd());
  process.exit(code);
}
