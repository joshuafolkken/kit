import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'

// Where a lane is cut from (joshuafolkken/kit#1535).
//
// **The bare default-branch name is the wrong start point, because git resolves it to the *local*
// `refs/heads/<default>` — a ref nothing in this workflow ever advances.** Merges happen on GitHub
// through `pnpm josh followup`, and this repository's main work tree does not have the
// default branch checked out, so there is no fast-forward for it to receive. It falls one commit
// further behind on every merge, and a lane opened from it starts without the work that was just
// merged. Measured on 2026-09-07: `refs/heads/main` was `e3a68c04` while `refs/remotes/origin/main`
// was `78f746f9`.
//
// **The remote-tracking ref is the one that is current**, because a fetch updates it without anyone
// checking anything out — which is exactly the property the local branch lacks. It is named in full
// (`refs/remotes/origin/<default>`) rather than as `origin/<default>`, so a local branch that
// happens to be called `origin/<default>` cannot capture the reading.

const REFS_REMOTES_ORIGIN_PREFIX = 'refs/remotes/origin/'

// A fetch *failure* is reported and stepped over rather than raised. `lane:open` has to keep working
// with no network at all — offline, and on a clone with no `origin` — and what it degrades to is
// whatever `origin/<default>` already holds, which is still never *behind* the local branch. Note
// what this does not cover: `fetch_branch` runs through `git_spawn.read`, which sets no
// timeout, so a connection that hangs rather than failing blocks here instead of degrading.
async function refresh_default_branch(default_branch: string): Promise<void> {
	try {
		await git_command.fetch_branch(default_branch)
	} catch {
		console.error(
			`Could not fetch origin/${default_branch}; opening the lane from the remote-tracking ref as it stands.`,
		)
	}
}

// Said out loud rather than taken quietly. The resolver answers the bare name for a repository with
// no remote *and* for a `rev-parse` that failed, and the second reading puts the lane back on the
// stale ref this module exists to avoid — so the fallback is never silent.
function report_local_fallback(default_branch: string): void {
	console.error(
		`No ${REFS_REMOTES_ORIGIN_PREFIX}${default_branch} to cut the lane from; using the local ${default_branch}, which may be behind what has been merged.`,
	)
}

/**
 * The commit-ish `git worktree add` should branch a lane from.
 *
 * The ref itself comes from `git_command.default_branch_reference`, which `change_base` resolves through
 * too — one resolution rather than two, so a lane is measured against the commit it was cut from.
 * What is added here is the fetch, which belongs to opening a lane and not to reading a diff.
 *
 * Falls back to the bare default-branch name where no remote-tracking ref exists — a fresh
 * `git init`, or a clone whose `origin` was removed. There the local branch is the only answer
 * there is, and it is not stale, because nothing else is advancing past it.
 */
async function resolve(): Promise<string> {
	const default_branch = await git_command.get_default_branch()

	await refresh_default_branch(default_branch)

	const start_point = await git_command.default_branch_reference()

	if (!start_point.startsWith(REFS_REMOTES_ORIGIN_PREFIX)) report_local_fallback(default_branch)

	return start_point
}

// **A branch that already exists is attached to, never cut afresh** (joshuafolkken/kit#1627). Its
// commits are a child's finished work: `epicrun` leaves a lane's branch behind whenever a child is
// parked after pushing, and `lane:close` deletes the local branch while the remote one and the pull
// request stay. Cutting a new `<N>-lane` from the default branch there orphans both — and it did so
// **silently**, because `worktree add -b` succeeds once the local branch is gone. The loud half of
// the same defect was `fatal: a branch named '<N>-lane' already exists`, which at least stopped.
//
// The reuse is said out loud for the same reason the local fallback above is: a lane that starts on
// somebody's pushed commits is not the lane a fresh open produces, and reading the two as one is how
// the work gets overwritten.
function report_reuse(branch_name: string, where: string): void {
	console.error(
		`Reusing the existing ${where} branch ${branch_name}; this lane starts at that branch's own commits rather than at the default branch.`,
	)
}

// Said when the remote could not be consulted, so a lane that may be behind it is not mistaken for
// one that is current. The ref is still used: the alternative is cutting a fresh branch over commits
// somebody pushed, which is the silent failure this whole module exists to remove, and starting on a
// stale ref is loud and recoverable where that is neither.
function report_unverified(branch_name: string): void {
	console.error(
		`Could not refresh ${REFS_REMOTES_ORIGIN_PREFIX}${branch_name} from origin; using it as it stands, which may be behind the remote.`,
	)
}

type RemoteAnswer = 'absent' | 'present' | 'unreachable'

// **The remote-tracking ref is not evidence that the remote still has the branch.** Nothing in the
// lane lifecycle prunes it — `lane:close` removes the work tree and the local branch, and GitHub
// deletes the remote branch at the merge — so the ref survives both, and reading one as "the child's
// work is on origin" would cut a lane from a commit that merged long ago. `ls-remote` is asked
// instead, because it separates the two answers a `fetch` failure runs together: a branch that is
// gone from a remote that cannot be reached.
async function ask_remote(branch_name: string): Promise<RemoteAnswer> {
	try {
		const heads = await git_worktree.ls_remote_branch(branch_name)

		return heads.trim() === '' ? 'absent' : 'present'
	} catch {
		return 'unreachable'
	}
}

async function refresh_lane_branch(branch_name: string): Promise<void> {
	try {
		await git_command.fetch_branch(branch_name)
	} catch {
		console.error(`Could not fetch ${branch_name} from origin.`)
	}
}

async function tracking_reference(branch_name: string): Promise<string | undefined> {
	const names = await git_command.branch_names_remote(`origin/${branch_name}`)

	return names.length > 0 ? `${REFS_REMOTES_ORIGIN_PREFIX}${branch_name}` : undefined
}

/**
 * The ref for a branch origin still has — fetched first, so the lane starts at the tip rather than
 * at whatever this checkout last saw.
 *
 * **A `present` answer is authoritative, so this arm never degrades to a new branch.** With the
 * fetch failed and no remote-tracking ref to fall back on — a second machine, a fresh clone — a
 * fall-through would cut `<N>-lane` from the default branch over commits origin demonstrably has,
 * which is the silent orphan this module exists to prevent. The Issue asks for an explicit report
 * in place of a silent new branch, and refusing is that report: both ways out are named, and
 * `lane:open` already fails this way for a seat it cannot read and an install it cannot finish.
 */
async function present_reference(branch_name: string): Promise<string> {
	await refresh_lane_branch(branch_name)

	const reference = await tracking_reference(branch_name)

	if (reference !== undefined) return reference

	throw new Error(
		`origin has ${branch_name}, but it could not be fetched, so this lane cannot be opened on the commits already pushed to it. Fetch it — \`git fetch origin ${branch_name}\` — and run \`pnpm josh lane:open\` again.`,
	)
}

// `absent` is the one answer that refuses the ref: the branch is gone from origin, so a ref still
// pointing at it is stale and the lane is cut from the default branch as any new one is.
async function remote_reference_for(branch_name: string): Promise<string | undefined> {
	const answer = await ask_remote(branch_name)

	if (answer === 'absent') return undefined
	if (answer === 'present') return await present_reference(branch_name)

	report_unverified(branch_name)

	return await tracking_reference(branch_name)
}

/**
 * What `git worktree add` should be given for a lane on `branch_name`.
 *
 * `undefined` means **attach**: the branch is already here, so the work tree is put on it and no
 * branch is created. Every other answer is a commit-ish a new branch is cut from — the remote-tracking
 * ref of the lane branch when only the remote has it, and the default branch's when neither does,
 * which is the behavior every lane had before joshuafolkken/kit#1627.
 *
 * **Nothing here deletes a branch to simplify the call.** That is what would lose the commits this
 * function exists to keep.
 */
async function resolve_for_branch(branch_name: string): Promise<string | undefined> {
	if (await git_command.branch_exists(branch_name)) {
		report_reuse(branch_name, 'local')

		return undefined
	}

	const remote_reference = await remote_reference_for(branch_name)

	if (remote_reference === undefined) return await resolve()

	report_reuse(branch_name, 'origin')

	return remote_reference
}

const lane_start_point = { resolve, resolve_for_branch }

export { lane_start_point }
