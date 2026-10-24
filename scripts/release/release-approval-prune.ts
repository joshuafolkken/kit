import { git_spawn } from '#scripts/git/git-spawn'

// **A release drops every `josh metrics` approval the default branch holds** (joshuafolkken/kit#4187).
// The release work tree is cut from `origin/<default>`, so every file it holds under the directory
// belongs to an issue that already merged. Such a file is read only to tell it apart from a branch's
// new one (`tools/metrics/metrics-ratchet.ts` → `fresh_approvals`): a branch's merge-base still holds
// it unchanged, and a branch that merges the release in loses it on both sides, so removing it changes
// no verdict. `--ignore-unmatch` makes a repository with no approvals a no-op.

const APPROVAL_DIRECTORY = '.josh/metrics-accepted'
const APPROVAL_PREFIX = `${APPROVAL_DIRECTORY}/`

async function prune(): Promise<void> {
	await git_spawn.read(['rm', '-r', '-q', '--ignore-unmatch', '--', APPROVAL_DIRECTORY])
}

// A repository-relative path under the approval directory.
function is_approval(file: string): boolean {
	return file.startsWith(APPROVAL_PREFIX)
}

const release_approval_prune = { APPROVAL_DIRECTORY, is_approval, prune }

export { release_approval_prune }
