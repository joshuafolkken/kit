import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import { session_language } from '#scripts/josh/session-language'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_merge } from './run-merge'

// The comments `run:merge` posts for a person to read, in the session language. The labels, the list
// line labels, commands and paths stay English (joshuafolkken/kit#7699, joshuafolkken/kit#7698).

interface Prose {
	decision_head: string
	failures: string
	next: string
	kept_lane: string
	waiting_head: string
	waiting_why: (waits: string) => string
	waiting_next: string
	park_head: string
	park_read: string
	streak_unrecorded: string
	streak: (failures: string, limit: string) => string
	park_next: (transcript: string, step: string) => string
	progress_head: string
}

const ENGLISH_PROSE: Prose = {
	decision_head: `Parked with \`${NEEDS_DECISION_LABEL}\` by \`pnpm josh run:merge\`: the child waits for your answer.`,
	failures: 'unchanged.',
	next: `answer the question on this issue, then remove \`${NEEDS_DECISION_LABEL}\` to resume.`,
	kept_lane:
		"The split left this issue's lane open: it still holds a commit, an uncommitted change or a live process",
	waiting_head:
		'Released to wait by `pnpm josh run:merge`, the `backlogrun` driver — not parked, and not counted as a failure.',
	waiting_why(waits: string): string {
		return `the child’s session ended unfinished while it waits on: ${waits}.`
	},
	waiting_next:
		'when it runs is already recorded — it becomes runnable again once its blockers merge, its start date arrives and its sample condition is met; a blocker outside the backlog still needs a person to land it.',
	park_head: `Parked with \`${RUN_STALLED_LABEL}\` by \`pnpm josh run:merge\`, the \`backlogrun\` driver — a mechanical failure, with no decision to make.`,
	park_read:
		'the issue is OPEN, carries no park label, `needs-human-review` or `epic`, no merged pull request’s `closes #N` names it, and it declares no open blocker, start date still ahead or sample condition not yet met.',
	streak_unrecorded: 'not recorded (no carry record).',
	streak(failures: string, limit: string): string {
		return `${failures} of ${limit} (every ${limit} in a row checks \`main\`).`
	},
	park_next(transcript: string, step: string): string {
		const named = transcript === '' ? '' : ` (${transcript})`

		return `read the child’s transcript${named}, ${step}.`
	},
	progress_head: 'Run progress (generated from the carry record):',
}

const JAPANESE_PROSE: Prose = {
	decision_head: `\`pnpm josh run:merge\` が \`${NEEDS_DECISION_LABEL}\` で park した: 子があなたの回答を待っている。`,
	failures: '変わらない。',
	next: `この Issue の質問に答えてから \`${NEEDS_DECISION_LABEL}\` を外すと再開する。`,
	kept_lane:
		'分割でこの Issue のレーンを開けたままにした: コミット、未コミットの変更、または動いているプロセスがまだある',
	waiting_head:
		'`pnpm josh run:merge`（`backlogrun` の取りまとめ役）が待ちに戻した — park ではなく、失敗にも数えない。',
	waiting_why(waits: string): string {
		return `子のセッションは、次を待ったまま未完で終わった: ${waits}。`
	},
	waiting_next:
		'実行の時期はすでに記録済み — ブロッカーがマージされ、開始日が来て、サンプル条件を満たすと再び実行できる。backlog の外のブロッカーは、人が取り込む必要がある。',
	park_head: `\`pnpm josh run:merge\`（\`backlogrun\` の取りまとめ役）が \`${RUN_STALLED_LABEL}\` で park した — 機械的な失敗で、判断することはない。`,
	park_read:
		'Issue は OPEN で、park ラベル・`needs-human-review`・`epic` のどれも付いておらず、マージ済みのプルリクエストの `closes #N` にも挙がっておらず、未解決のブロッカー・まだ来ない開始日・満たしていないサンプル条件も宣言していない。',
	streak_unrecorded: '記録なし（carry 記録が無い）。',
	streak(failures: string, limit: string): string {
		return `${failures} / ${limit}（${limit} 回連続するごとに \`main\` を確かめる）。`
	},
	park_next(transcript: string, step: string): string {
		const named = transcript === '' ? '' : `（${transcript}）`

		return `子のトランスクリプト${named}を読み、${step}`
	},
	progress_head: 'ランの進み具合（carry 記録から生成）:',
}

// Why the run parked a child it judged failed. A child that stops itself leaves its own comment; one
// the driver stops leaves none, so this tells a person why it carries `run:stalled`.
interface ParkReason {
	child: string
	cause: string
	carry: RunCarry | undefined
	output: string | undefined
}

function is_japanese(): boolean {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
}

function prose_of(): Prose {
	return is_japanese() ? JAPANESE_PROSE : ENGLISH_PROSE
}

function decision_comment(why: string): string {
	const prose = prose_of()

	return [
		prose.decision_head,
		`- Decision: ${why}`,
		`- Consecutive failures: ${prose.failures}`,
		`- Next: ${prose.next}`,
	].join('\n')
}

function kept_lane_comment(directory: string): string {
	return `${prose_of().kept_lane} — ${directory}`
}

// Why the run released a child it would otherwise have parked: the child records open blockers or a
// start date still ahead or samples still short, so when it runs is already decided and it waits
// rather than asking a person.
function waiting_comment(waits: ReadonlyArray<string>): string {
	const prose = prose_of()

	return [
		prose.waiting_head,
		`- Why: ${prose.waiting_why(waits.join(', '))}`,
		`- Next: ${prose.waiting_next}`,
	].join('\n')
}

function streak_line(prose: Prose, carry: RunCarry | undefined): string {
	const limit = String(run_merge.CONSECUTIVE_FAILURE_LIMIT)
	const streak =
		carry === undefined ? prose.streak_unrecorded : prose.streak(String(carry.failures), limit)

	return `- Consecutive failures: ${streak}`
}

// The resume step. `run_stalled` words only the ordinary cause in Japanese, so a cause with its own
// recovery (a stale hand-off) keeps its English step behind a Japanese lead-in.
function next_step_of(reason: ParkReason): string {
	const step = run_stalled.next_step(reason.child, reason.cause)

	if (!is_japanese()) return step
	if (step === run_stalled.next_step(reason.child)) return run_stalled.next_step_ja(reason.child)

	return `次の手順で再開する: ${step}.`
}

function park_comment(reason: ParkReason): string {
	const prose = prose_of()
	const transcript = reason.output === undefined ? '' : `\`${reason.output}\``

	const body = [
		prose.park_head,
		`- Why: ${reason.cause}`,
		`- Read: ${prose.park_read}`,
		streak_line(prose, reason.carry),
		`- Next: ${prose.park_next(transcript, next_step_of(reason))}`,
	].join('\n')

	return issue_outcome.body_of({
		body,
		summary: run_stalled.next_action(reason.child, reason.cause),
	})
}

// The progress comment, generated from the single-source carry record so the counters live in one
// place and this text is derived rather than a second copy kept alongside it.
function counters_comment(carry: RunCarry): string {
	return [
		prose_of().progress_head,
		`- started: ${carry.started_at}`,
		`- merged: ${String(carry.merged)}`,
		`- filed: ${String(carry.filed)}`,
		`- consecutive failures: ${String(carry.failures)}`,
		`- consecutive outages: ${String(carry.outages)}`,
		`- cuts crossed: ${String(carry.cuts)}`,
	].join('\n')
}

const run_merge_prose = {
	counters_comment,
	decision_comment,
	kept_lane_comment,
	park_comment,
	waiting_comment,
}

export type { ParkReason }
export { run_merge_prose }
