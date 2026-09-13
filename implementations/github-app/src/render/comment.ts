import type { Verdict, VerdictStatus } from '../types';
import { renderState, type ReviewState } from '../state/blob';

export type GateMode = 'advisory' | 'required';

export type CommentState =
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'verdict'; readonly verdict: Verdict }
  | { readonly kind: 'error'; readonly message: string };

export interface RenderContext {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly headSha: string;
  readonly state: CommentState;
  readonly updatedAt: Date;
  /** Carried in the comment body so the next review can read it back. */
  readonly carry?: ReviewState;
}

const STATUS_CELL: Record<VerdictStatus, string> = {
  clean: '🟢 Clean',
  soft_warnings: '🟠 Soft warnings',
  strategic_blocker: '🔴 Strategic blocker',
  bounded: '🟠 Too large to review',
  skipped: '⚪ No strategic surface',
  unconfigured: '⛔ Not configured',
};

const SEVERITY_MARK = { block: '🔴', warn: '🟠', info: '⚪' } as const;

export const shortSha = (sha: string): string => sha.slice(0, 7);

const utcTime = (at: Date): string =>
  `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;

function findingsCell(verdict: Verdict): string {
  if (verdict.findings.length === 0) return '—';
  const counts = { block: 0, warn: 0, info: 0 };
  for (const finding of verdict.findings) counts[finding.severity] += 1;
  return (['block', 'warn', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(' · ');
}

function statusCell(state: CommentState): string {
  if (state.kind === 'reviewing') return '🟡 Reviewing';
  if (state.kind === 'error') return '⛔ Review failed';
  return STATUS_CELL[state.verdict.status];
}

function renderFindings(verdict: Verdict, headSha: string): string {
  if (verdict.findings.length === 0) return '';

  const blocks = verdict.findings.map((finding) => {
    const mark = SEVERITY_MARK[finding.severity];
    // A finding the author has not addressed across several pushes is a
    // different conversation from one raised a minute ago.
    const age =
      finding.firstSeenSha && finding.firstSeenSha !== headSha
        ? ` *(unresolved since \`${shortSha(finding.firstSeenSha)}\`)*`
        : '';

    // Compact on purpose: title, body, then action and source on one line. A
    // verdict is skimmed between other work; rules between findings only add height.
    return [
      `${mark} **${finding.title}**${age}`,
      finding.body,
      `*Suggested action:* ${finding.suggestedAction} · *Source:* ${finding.source}`,
    ].join('  \n');
  });

  return `\n${blocks.join('\n\n')}\n`;
}

/**
 * The receipt.
 *
 * Every verdict states what it was judged against. Four days of confident
 * reviews with no rubric behind them is the failure this line exists to make
 * impossible to hold silently.
 */
function renderReceipt(verdict: Verdict): string {
  if (!verdict.receipt) return '';
  const { documentsRead, decisionCount, rubricSha } = verdict.receipt;
  const docs = documentsRead.length > 0 ? documentsRead.join(' · ') : 'no documents';
  return `read: ${docs} · ${decisionCount} decision files · rubric sha \`${rubricSha}\``;
}

function renderStats(verdict: Verdict): string {
  const stats = verdict.stats;
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.diffLines !== undefined) parts.push(`${stats.diffLines} lines reviewed`);
  if (stats.durationMs !== undefined) parts.push(`${Math.round(stats.durationMs / 1000)}s`);
  if (stats.costCents !== undefined) parts.push(`$${(stats.costCents / 100).toFixed(2)}`);
  return parts.join(' · ');
}

/**
 * Render the sticky comment.
 *
 * The service owns this markdown end to end. Nothing a model emits reaches a
 * pull request except as data passed through here.
 */
export function renderComment(ctx: RenderContext): string {
  const lines: string[] = [
    '### Watchman — strategic alignment',
    '',
    '| Review | Verdict | Findings | Commit | Updated (UTC) |',
    '| --- | --- | --- | --- | --- |',
  ];

  const verdict = ctx.state.kind === 'verdict' ? ctx.state.verdict : null;
  const findings = verdict ? findingsCell(verdict) : '—';

  lines.push(
    `| \`${ctx.owner}/${ctx.repo}\` · #${ctx.prNumber} | ${statusCell(ctx.state)} | ${findings} ` +
      `| \`${shortSha(ctx.headSha)}\` | ${utcTime(ctx.updatedAt)} |`,
  );

  if (ctx.state.kind === 'error') {
    lines.push('', `> ${ctx.state.message}`, '', 'Re-run with `/watchman review`.');
  }

  if (verdict) {
    const body = renderFindings(verdict, ctx.headSha);
    if (body) lines.push('', body.trim());
    if (verdict.bottomLine) lines.push('', `**Bottom line.** ${verdict.bottomLine}`);

    const footer = [renderReceipt(verdict), renderStats(verdict)].filter(Boolean);
    if (footer.length > 0) lines.push('', '---', '', ...footer.map((line) => `<sub>${line}</sub>`));
  }

  if (ctx.carry) lines.push('', renderState(ctx.carry));

  return lines.join('\n');
}
