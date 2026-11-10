import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read } from '#scripts/issue/issue-read'
import { josh_command } from '#scripts/josh/josh-run'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_retry } from './backlog-drive-retry'

// What `backlog:drive` does after `run:merge` answered: a merged child retries the issues waiting on
// it, and a park whose recommendation needs no permission at all is decided here (joshuafolkken/kit#6738) — the
// decision through `issue:comment`, then `run:park --clear`, whose label removal lets the next offer
// hand the child back to a lane. A decided park is not booked done (`mark_done`), so a named run keeps the
// child and the issues declared after it. Once per issue: a child that parks again is left to a person.

const DECISION_HEADING = '## Decision (backlog:drive)'
const SUCCESS_EXIT_CODE = 0

interface ParkPorts {
	bodies: (issue: string) => Promise<ReadonlyArray<string>>
	run: (argv: ReadonlyArray<string>) => Promise<number>
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

const PORTS: ParkPorts = { bodies: trusted_bodies, run: run_josh }

function decision_of(pick: number): string {
	return `${DECISION_HEADING}\n\nTaking recommended option ${String(pick)}: tier A, no person's permission needed.`
}

function pick_of(bodies: ReadonlyArray<string>): number | undefined {
	if (bodies.some((body) => body.startsWith(DECISION_HEADING))) return undefined
	const park = bodies.findLast((body) => run_park_body.problem_of(body) === undefined)

	return park === undefined ? undefined : run_park_body.auto_pick(park)
}

async function resolve(issue: string, ports: ParkPorts = PORTS): Promise<boolean> {
	const pick = pick_of(await ports.bodies(issue))

	if (pick === undefined) return false
	const commented = await ports.run(['issue:comment', issue, '--body', decision_of(pick)])

	if (commented !== SUCCESS_EXIT_CODE) return false

	return (await ports.run(['run:park', issue, '--clear'])) === SUCCESS_EXIT_CODE
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
