import { git_worktree } from './git-worktree'

// Does origin still have this branch, and could we even tell? (joshuafolkken/kit#1641; lifted out of
// `scripts/lane/lane-start-point.ts`, which asked the question first.)
//
// **The remote-tracking ref is not evidence that the remote still has the branch.** Nothing here
// prunes it — `lane:close` removes the work tree and the local branch, GitHub deletes the remote
// branch at the merge, and the ref survives both — so reading one as "origin has it" answers about
// whatever this checkout last fetched. `ls-remote` is asked instead, because it separates the two
// answers a `fetch` failure runs together: a branch that is gone, from a remote that cannot be
// reached.
//
// **Two callers need that same three-way answer, which is why it lives here rather than inside
// either of them.** `lane-start-point.ts` decides which ref a reopened lane is cut from, and
// `release-publish.ts` decides whether a release branch name is already taken. What each of them
// *does* with an answer differs — a lane degrades to the tracking ref and says so, a release refuses
// outright — so the shared part is the asking alone, and copying it into the second caller would be
// the clone `CLAUDE.md` prohibits.
type RemoteAnswer = 'absent' | 'present' | 'unreachable'

// Empty output on a zero exit is `absent`; any output is `present`; a rejection — `ls-remote` exits
// non-zero when the transport fails, and `git_spawn.read` turns that into a throw — is
// `unreachable`, **never folded into `absent`**. Folding them is what makes a guard answer "nothing
// there" to a question it could not ask.
async function ask(branch_name: string): Promise<RemoteAnswer> {
	try {
		const heads = await git_worktree.ls_remote_branch(branch_name)

		return heads.trim() === '' ? 'absent' : 'present'
	} catch {
		return 'unreachable'
	}
}

const git_remote_branch = {
	ask,
}

export { git_remote_branch }
export type { RemoteAnswer }
