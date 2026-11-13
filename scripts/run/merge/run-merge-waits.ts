import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_label_name, NOT_BEFORE_LABEL } from '#scripts/issue/issue-labels'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { issue_sample_prime } from '#scripts/issue/issue-sample-prime'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { MergeContext } from './run-merge-steps'

const NOT_BEFORE_WAIT = 'a start date still ahead (`not-before`)'

async function open_blockers(child: string): Promise<ReadonlyArray<string>> {
	try {
		const references = await git_gh_command.issue_blocked_by_references(child, '')

		return references
			.filter((blocker) => blocker.state === 'OPEN')
			.map((blocker) => issue_cite.plain_for('github', blocker.number, blocker.repo))
	} catch {
		return []
	}
}

async function has_not_before_label(ctx: MergeContext): Promise<boolean> {
	const state = await issue_state_cli.read_issue(ctx.child, ctx.repo)

	return state.kind === 'state' && has_label_name(state.state.labels, NOT_BEFORE_LABEL)
}

async function start_date_wait(ctx: MergeContext): Promise<ReadonlyArray<string>> {
	const body = await git_gh_command.issue_get_body(ctx.child, ctx.repo)
	if (body === undefined) return (await has_not_before_label(ctx)) ? [NOT_BEFORE_WAIT] : []
	await issue_sample_prime.prime([body])
	const reason = issue_not_before.waiting_reason(body)

	return reason === undefined ? [] : [reason]
}

// A withheld resume is already known to be retryable, including a read failure. Do not turn it
// into a mechanical failure because a second GitHub read still cannot answer.
async function read(ctx: MergeContext): Promise<ReadonlyArray<string>> {
	const deferred = await lane_dispatch_dependency.deferred(ctx.child)
	if (deferred.length > 0) return deferred

	return [...(await open_blockers(ctx.child)), ...(await start_date_wait(ctx))]
}

const run_merge_waits = { read }

export { run_merge_waits }
