import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import type { TypeScriptApi } from './comment-ranges'
import { removed_tests } from './removed-tests'
import { review_code_tree } from './review-code-tree'
import { test_titles } from './test-titles'

// The reads behind `removed_tests`: the change base, the test files changed since it, each one's text
// at the base and in the working tree, and the pull request body. Kept apart so the comparison stays
// pure.
//
// **The base is the tree's, through a merge in progress** (`change_base.resolved_through_merge`): the
// head side is the work tree, so a stopped merge of the default branch has already removed whatever
// tests the default branch removed, and measuring from `HEAD`'s older merge-base would list them as
// this change's own.
//
// **A base that cannot be resolved is a refusal, not a pass** — the tests it would have held are
// exactly what this gate exists to see. A file is read at the base only where the base holds it, so a
// failed `git show` throws rather than reading as a file that had no tests. TypeScript is an optional
// peer of this package (`review_code_tree.load_typescript`): a project without it has no titles to
// compare and merges as before.

const UNREADABLE_MESSAGE =
	'Merge refused: the change base could not be resolved, so the tests this change removes could not be listed; re-run once `git merge-base` answers.'

function titles_in(api: TypeScriptApi, texts: ReadonlyArray<string>): ReadonlyArray<string> {
	return texts.flatMap((text) => test_titles.titles_of(api, text))
}

async function base_texts(
	base: string,
	paths: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
	const held = await changed_paths.read_held_at(base, paths)

	return await Promise.all(
		held.map(async (relative) => await git_command.show_file(`${base}:${relative}`)),
	)
}

// A test file the change deleted is absent from the tree, and every title it held reads as gone.
function tree_texts(root: string, paths: ReadonlyArray<string>): ReadonlyArray<string> {
	return paths
		.map((relative) => path.join(root, relative))
		.filter((absolute) => existsSync(absolute))
		.map((absolute) => readFileSync(absolute, 'utf8'))
}

async function read(): Promise<ReadonlyArray<string> | undefined> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) return undefined
	const root = await git_command.repository_root()
	const api = review_code_tree.load_typescript(root)

	if (api === undefined) return []
	const changed = await changed_paths.read_changed_since(base)
	const paths = changed.filter((relative) => test_declared_logic.is_test_file(relative))
	const before = titles_in(api, await base_texts(base, paths))

	return removed_tests.removed(before, titles_in(api, tree_texts(root, paths)))
}

// `josh ship`'s preflight asks the body it is about to deliver, so a missing disposition stops it
// before the review rather than at the merge.
async function body_refusal(pr_body: string | undefined): Promise<string | undefined> {
	const removed = await read()

	if (removed === undefined) return UNREADABLE_MESSAGE
	const left = removed_tests.undisposed(removed, pr_body)

	return left.length === 0 ? undefined : removed_tests.refusal_message(left)
}

async function refusal(branch_name: string): Promise<string | undefined> {
	return await body_refusal(await git_gh_command.pr_get_body(branch_name))
}

const removed_tests_check = { body_refusal, read, refusal, UNREADABLE_MESSAGE }

export { removed_tests_check }
