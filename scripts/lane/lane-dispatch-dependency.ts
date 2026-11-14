import { performance } from 'node:perf_hooks'
import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { issue_sample_prime } from '#scripts/issue/issue-sample-prime'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_label } from '#scripts/run/run-label'
import { lane_state } from './lane-state'
import { lane_state_record } from './lane-state-record'

const WAIT_EXIT_CODE = 75
const WAIT_COMMAND = lane_state_record.DEPENDENCY_WAIT_COMMAND

interface DependencyWait {
	kind: 'dependency-wait'
	reason: string
}

async function unresolved(child: EpicChild): Promise<Array<EpicChild>> {
	const references = await epic_live.blockers(child.number, child.repo)
	const blockers = await Promise.all(
		references.map(async (reference) => await epic_live.child(reference.number, reference.repo)),
	)

	epic_cross_repo.reset_publish_cache()

	return blockers.filter(
		(blocker) => epic_cross_repo.resolve_cross_repo(blocker, child) !== 'resolved',
	)
}

async function start_wait(child: EpicChild): Promise<string | undefined> {
	if (issue_publication_state.is_pending(child.body)) return 'publication is pending'
	if (child.state !== 'OPEN') return 'issue is no longer open'
	await issue_sample_prime.prime([child.body])

	return issue_not_before.waiting_reason(child.body)
}

async function reason_of(issue: string): Promise<string | undefined> {
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) throw new Error('Cannot resolve launch repository')
	const child = await epic_live.child(Number(issue), repo)
	const wait = await start_wait(child)
	if (wait !== undefined) return wait
	const blockers = await unresolved(child)
	if (blockers.length === 0) return undefined

	const names = blockers.map((blocker) =>
		session_cite.issue(blocker.number, undefined, blocker.repo),
	)

	return `unfinished blockers: ${names.join(', ')}`
}

function waiting(issue: string, reason: string, started: number): DependencyWait {
	const elapsed = Math.round(performance.now() - started)

	console.error(`Lane ${session_cite.issue(issue)} waiting (${String(elapsed)} ms): ${reason}`)

	return { kind: 'dependency-wait', reason }
}

// Called at each lane worker spawn, including resume generations. A failed read is a retryable wait.
async function check(issue: string): Promise<DependencyWait | undefined> {
	const started = performance.now()

	try {
		const reason = await reason_of(issue)
		if (reason === undefined) return undefined

		return waiting(issue, reason, started)
	} catch (error) {
		return waiting(issue, `unknown dependency state: ${error_text.message_of(error)}`, started)
	}
}

async function defer(issue: string): Promise<void> {
	await lane_state.record_change({ issue, state: 'paused', command: WAIT_COMMAND })
	await run_label.unmark(issue)
}

async function deferred(issue: string): Promise<ReadonlyArray<string>> {
	const state = await lane_state.read_state(issue)

	return state?.changed_by === WAIT_COMMAND ? ['launch dependency confirmation'] : []
}

async function begin(issue: string): Promise<void> {
	const waits = await deferred(issue)
	if (waits.length === 0) return
	await lane_state.record_change({ issue, state: 'running', command: 'lane:dispatch' })
}

const lane_dispatch_dependency = { check, defer, deferred, begin, WAIT_EXIT_CODE }

export type { DependencyWait }
export { lane_dispatch_dependency }
