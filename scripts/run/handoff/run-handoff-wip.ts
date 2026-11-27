// `run:handoff --wip <name>` (joshuafolkken/kit#9148): the named `wip/<name>` branch resolved to its commit
// here, so the row the child's `issue:file` writes carries the code's sha, never one copied from prose. A
// branch naming no commit is refused before any child starts.

import { git_spawn } from '#scripts/git/git-spawn'
import { issue_body_adopt_branch } from '#scripts/issue/issue-body-adopt-branch'
import type { LaunchRequest } from '#scripts/run/detached-launch'

const COMMIT_PEEL = '^{commit}'

type WipEnvironment = { environment: Readonly<Record<string, string>> } | { problem: string }

// The commit `reference` names, or `undefined` when it names none.
async function resolve_commit(reference: string): Promise<string | undefined> {
	try {
		return await git_spawn.read(['rev-parse', '--verify', '--quiet', `${reference}${COMMIT_PEEL}`])
	} catch {
		return undefined
	}
}

// The child's extra environment for `branch`: none without `--wip`, the resolved row with it.
async function environment_of(
	branch: string | undefined,
	resolve: (reference: string) => Promise<string | undefined>,
): Promise<WipEnvironment> {
	if (branch === undefined) return { environment: {} }

	const sha = await resolve(branch)

	if (sha === undefined) return { problem: `--wip: no branch ${branch} in this repository` }

	const value = issue_body_adopt_branch.to_environment({ branch, sha })

	return { environment: { [issue_body_adopt_branch.ENVIRONMENT_KEY]: value } }
}

function with_environment(
	request: LaunchRequest,
	environment: Readonly<Record<string, string>>,
): LaunchRequest {
	return { ...request, env: { ...request.env, ...environment } }
}

const run_handoff_wip = { environment_of, resolve_commit, with_environment }

export { run_handoff_wip }
