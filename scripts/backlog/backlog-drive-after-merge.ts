import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_read } from '#scripts/issue/issue-read'
import { josh_command } from '#scripts/josh/josh-run'
import { session_language } from '#scripts/josh/session-language'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_retry } from './backlog-drive-retry'

// What `backlog:drive` does after `run:merge` answered: a merged child retries the issues waiting on
// it, and a park whose recommendation needs no permission at all is decided here (joshuafolkken/kit#6738) — the
// decision through `issue:comment`, then `run:park --clear`, whose label removal lets the next offer
// hand the child back to a lane. A decided park is not booked done (`mark_done`), so a named run keeps the
// child and the issues declared after it. Once per issue: a child that parks again is left to a person.
//
// A park with no recommendation is decided too (joshuafolkken/kit#7077): `run_park_body.default_pick`'s
// option, recorded as `Auto-decided: …` and announced afterwards, so a person overrides it with a
// later decision comment instead of being waited on. A park whose every option a person must take stays.

// The heading and the `Auto-decided: ` prefix are matched (here and by `run-cut-digest.ts`), so they stay
// English; the prose under them follows the session language (`prompts/collaboration-workflow/overview.md`).
const DECISION_HEADING = '## Decision (backlog:drive)'
const DECISION_PREFIX = 'Auto-decided: '
const SUCCESS_EXIT_CODE = 0

interface DecisionWords {
	recommended: (pick: string) => string
	choice: (pick: string, over: string) => string
	no_other: string
	other: (options: string) => string
	reason: string
}

function english_recommended(pick: string): string {
	return `Taking recommended option ${pick}: tier A, no person's permission needed.`
}

function english_choice(pick: string, over: string): string {
	return `option ${pick} over ${over}`
}

function english_other(options: string): string {
	return `option ${options}`
}

function japanese_recommended(pick: string): string {
	return `推奨案 ${pick} を選ぶ。tier A で、人の許可は要らない。`
}

function japanese_choice(pick: string, over: string): string {
	return `案 ${pick} を選ぶ（${over}）`
}

function japanese_other(options: string): string {
	return `案 ${options} より優先`
}

const EN: DecisionWords = {
	recommended: english_recommended,
	choice: english_choice,
	no_other: 'no other option',
	other: english_other,
	reason:
		' because the park had no recommendation and it is the first reversible option with the smallest change (not tier C, no permission, no size approval).',
}

const JA: DecisionWords = {
	recommended: japanese_recommended,
	choice: japanese_choice,
	no_other: 'ほかに案は無い',
	other: japanese_other,
	reason:
		'。推奨案が無く、戻せる案（tier C でなく、許可もサイズ承認も要らない）のうち変更が最も小さい最初の案だから。',
}

function words(): DecisionWords {
	return session_language.is_japanese(session_language.resolve_session_lang().lang) ? JA : EN
}

interface ParkPorts {
	bodies: (issue: string) => Promise<ReadonlyArray<string>>
	run: (argv: ReadonlyArray<string>) => Promise<number>
	notify: (line: string) => Promise<unknown>
}

interface Decision {
	text: string
	notice?: string
}

async function trusted_bodies(issue: string): Promise<ReadonlyArray<string>> {
	const json = await git_gh_issue_read.issue_list_comments(issue)
	const comments = await issue_read.parse_comments(json)

	return issue_read.trusted_bodies(comments ?? [])
}

async function run_josh(argv: ReadonlyArray<string>): Promise<number> {
	const result = await josh_command.josh_run(argv, { should_forward_stderr: true })

	return result.code
}

async function notify_decided(line: string): Promise<boolean> {
	return await telegram_notify.decided({
		body: line,
		recovery: `the "${DECISION_HEADING}" comment`,
	})
}

const PORTS: ParkPorts = { bodies: trusted_bodies, run: run_josh, notify: notify_decided }

function recommended(pick: number): Decision {
	return { text: words().recommended(String(pick)) }
}

function defaulted(issue: string, park: string): Decision | undefined {
	const pick = run_park_body.default_pick(park)

	if (pick === undefined) return undefined
	const prose = words()
	const over = pick.over.length === 0 ? prose.no_other : prose.other(pick.over.join(', '))
	const choice = `${DECISION_PREFIX}${prose.choice(String(pick.number), over)}`

	return {
		text: `${choice}${prose.reason}`,
		notice: `${issue_cite.plain_for('program', issue)}: ${choice}`,
	}
}

function decision_of(issue: string, bodies: ReadonlyArray<string>): Decision | undefined {
	if (bodies.some((body) => body.startsWith(DECISION_HEADING))) return undefined
	const park = bodies.findLast((body) => run_park_body.is_park(body))

	if (park === undefined) return undefined
	const pick = run_park_body.auto_pick(park)

	return pick === undefined ? defaulted(issue, park) : recommended(pick)
}

// The decision commented, then the park cleared; a failed comment leaves the park as it was.
async function is_recorded(issue: string, text: string, ports: ParkPorts): Promise<boolean> {
	const body = `${DECISION_HEADING}\n\n${text}`

	const commented = await ports.run(['issue:comment', issue, '--body', body])

	if (commented !== SUCCESS_EXIT_CODE) return false

	return (await ports.run(['run:park', issue, '--clear'])) === SUCCESS_EXIT_CODE
}

// A default pick only is announced, after the fact: the child's own recommendation needs no notice.
async function resolve(issue: string, ports: ParkPorts = PORTS): Promise<boolean> {
	const decision = decision_of(issue, await ports.bodies(issue))

	if (decision === undefined || !(await is_recorded(issue, decision.text, ports))) return false
	if (decision.notice !== undefined) await ports.notify(decision.notice)

	return true
}

async function after_merge(
	issue: string,
	result: MergeResult,
	owner: string,
	ports: ParkPorts = PORTS,
): Promise<void> {
	if (result.outcome === 'parked' && (await resolve(issue, ports))) return
	await backlog_drive_named.mark_done(issue, result, owner)
	if (result.outcome === 'merged') await backlog_drive_retry.after_merge(Number(issue))
}

const backlog_drive_after_merge = { DECISION_HEADING, after_merge, resolve }

export type { ParkPorts }
export { backlog_drive_after_merge }
