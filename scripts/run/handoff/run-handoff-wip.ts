// `run:handoff --wip <name>` (joshuafolkken/kit#9148): the named `wip/<name>` branch resolved to its commit
// here, so the adopt row carries the code's sha, never one copied from prose. Where the row goes follows
// the line: on `new` the child's `issue:file` writes it from the handed-down environment; on one `#N`
// (an Issue the consultation already filed) it is written into #N's body before the child starts. Any
// other line, or a branch naming no commit, is refused before any child starts.

import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_spawn } from '#scripts/git/git-spawn'
import { issue_body_adopt_branch, type AdoptBranch } from '#scripts/issue/issue-body-adopt-branch'
import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'
import type { LaunchRequest } from '#scripts/run/detached-launch'

const COMMIT_PEEL = '^{commit}'
const NEW_TARGET = /^\S+ new(?: |$)/u
const ISSUE_TARGET = /^\S+ #(?<issue>[1-9]\d*)$/u
const TARGET_NOTE = '--wip needs `new` or one #N on the line'

type WipEnvironment = { environment: Readonly<Record<string, string>> } | { problem: string }

type WipTarget = { kind: 'new' } | { kind: 'issue'; issue: string } | { kind: 'refused' }

// The hand-off as `--wip` reads it: the branch and the line the child is started with.
interface WipHandoff {
	wip?: string | undefined
	line: string
}

interface WipPorts {
	// The commit `reference` names, or `undefined` when it names none.
	resolve: (reference: string) => Promise<string | undefined>
	// Writes `row` into the Issue's body; the problem when it could not, `undefined` once it is there.
	write_row: (issue: string, row: AdoptBranch) => Promise<string | undefined>
}

// The commit `reference` names, or `undefined` when it names none.
async function resolve_commit(reference: string): Promise<string | undefined> {
	try {
		return await git_spawn.read(['rev-parse', '--verify', '--quiet', `${reference}${COMMIT_PEEL}`])
	} catch {
		return undefined
	}
}

// Where the row goes, from the tokens after the line's keyword: `new`, or exactly one `#N`.
function target_of(line: string): WipTarget {
	if (NEW_TARGET.test(line)) return { kind: 'new' }

	const issue = ISSUE_TARGET.exec(line)?.groups?.['issue']

	return issue === undefined ? { kind: 'refused' } : { kind: 'issue', issue }
}

// `body` written to `issue`; the problem when the write failed.
async function edited(issue: string, body: string): Promise<string | undefined> {
	try {
		await git_gh_issue_write.issue_edit_body(issue, body)

		return undefined
	} catch (error: unknown) {
		const cited = issue_cite.plain_for('terminal', issue)

		return `could not write ${cited}'s body: ${error_text.message_of(error)}`
	}
}

// `row` written into `issue`'s live body; the body is edited only when the row changes it.
async function write_row(issue: string, row: AdoptBranch): Promise<string | undefined> {
	const fetched = await git_gh_issue_read.issue_get_body_classified(issue)

	if (fetched.kind !== 'read') {
		return `could not read ${issue_cite.plain_for('terminal', issue)}'s body (${fetched.kind})`
	}

	const body = fetched.text ?? ''
	const written = issue_body_adopt_branch.with_row(body, row)

	if ('problem' in written) return written.problem

	return written.body === body ? undefined : await edited(issue, written.body)
}

async function placed(
	row: AdoptBranch,
	target: WipTarget,
	ports: WipPorts,
): Promise<WipEnvironment> {
	if (target.kind === 'new') {
		const value = issue_body_adopt_branch.to_environment(row)

		return { environment: { [issue_body_adopt_branch.ENVIRONMENT_KEY]: value } }
	}

	const issue = target.kind === 'issue' ? target.issue : ''
	const problem = await ports.write_row(issue, row)

	return problem === undefined ? { environment: {} } : { problem: `--wip: ${problem}` }
}

// The child's extra environment: none without `--wip`, the resolved row on `new`, none once the row is
// written into the named Issue.
async function environment_of(handoff: WipHandoff, ports: WipPorts): Promise<WipEnvironment> {
	const branch = handoff.wip

	if (branch === undefined) return { environment: {} }

	const target = target_of(handoff.line)

	if (target.kind === 'refused') return { problem: TARGET_NOTE }

	const sha = await ports.resolve(branch)

	if (sha === undefined) return { problem: `--wip: no branch ${branch} in this repository` }

	return await placed({ branch, sha }, target, ports)
}

function with_environment(
	request: LaunchRequest,
	environment: Readonly<Record<string, string>>,
): LaunchRequest {
	return { ...request, env: { ...request.env, ...environment } }
}

const run_handoff_wip = { environment_of, resolve_commit, with_environment, write_row }

export { run_handoff_wip }
