import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_read } from '#scripts/issue/issue-read'
import { josh_command } from '#scripts/josh/josh-run'
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

const DECISION_HEADING = '## Decision (backlog:drive)'
const SUCCESS_EXIT_CODE = 0
const DEFAULT_REASON =
	'because the park had no recommendation and it is the first reversible option with the smallest change (not tier C, no permission, no size approval)'

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
	const result = await josh_command.josh_run(argv, true)

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
	return {
		text: `Taking recommended option ${String(pick)}: tier A, no person's permission needed.`,
	}
}

function defaulted(issue: string, park: string): Decision | undefined {
	const pick = run_park_body.default_pick(park)

	if (pick === undefined) return undefined
	const over = pick.over.length === 0 ? 'no other option' : `option ${pick.over.join(', ')}`
	const choice = `Auto-decided: option ${String(pick.number)} over ${over}`

	return {
		text: `${choice} ${DEFAULT_REASON}.`,
		notice: `${issue_cite.plain_for('program', issue)}: ${choice}`,
	}
}

function decision_of(issue: string, bodies: ReadonlyArray<string>): Decision | undefined {
	if (bodies.some((body) => body.startsWith(DECISION_HEADING))) return undefined
	const park = bodies.findLast((body) => run_park_body.problem_of(body) === undefined)

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
