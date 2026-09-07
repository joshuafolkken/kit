import { git_command } from '#scripts/git/git-command'

// The checkout `josh review:brief` is describing — the one thing the forked `/code-review` agent
// cannot work out for itself (joshuafolkken/kit#1522).
//
// **`/code-review` runs in a fork that inherits the *session's* working directory, not the run's.**
// Where the run implementing the change is a lane — a linked work tree under `.kit-lanes/` — that is
// a different tree entirely, so the review reads the session's checkout: usually the default branch,
// with the previous child already merged into it. Nothing there is wrong, so the review comes back
// with no findings, and **the failure arrives as approval**. Naming the checkout is what removes the
// guess, and it is generated here rather than typed into a brief by hand: an absolute path a person
// has to remember to pass reopens the hole the first time it is forgotten, and reopens it silently.
//
// **The root is asked of git, never read from `process.cwd()`** — the same reading `review-tree.ts`
// makes, and for the same reason: run from a subdirectory, `cwd()` names a directory that is not the
// repository, and every path built on it resolves to nothing.

interface ReviewCheckout {
	root: string
	branch: string
	head: string
}

// Three git spawns that do not depend on each other, so they are issued together rather than one
// after another: the brief is printed in front of a review the run is waiting on.
async function read_checkout(): Promise<ReviewCheckout> {
	const [root, branch, head] = await Promise.all([
		git_command.repository_root(),
		git_command.branch(),
		git_command.head_commit(),
	])

	return { root, branch, head }
}

// **All three, not the root alone.** A second work tree of the same repository has a different root,
// which the root test catches on its own; a `git switch` inside the right tree does not, and that is
// the case `epicrun.md` → "Lanes" warns about, since a lane's branch is what its commit lands on.
// The head is the third: a tree that moved between the brief and the review is not the tree the
// brief described.
function is_same_checkout(expected: ReviewCheckout, actual: ReviewCheckout): boolean {
	return (
		expected.root === actual.root &&
		expected.branch === actual.branch &&
		expected.head === actual.head
	)
}

function describe_checkout(checkout: ReviewCheckout): string {
	return `${checkout.root} (branch ${checkout.branch}, HEAD ${checkout.head})`
}

const review_checkout = { describe_checkout, is_same_checkout, read_checkout }

export type { ReviewCheckout }
export { review_checkout }
