import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import type { TypeScriptApi } from './comment-ranges'
import { removed_tests, type Removal } from './removed-tests'
import { renamed_tests } from './renamed-tests'
import { review_code_tree } from './review-code-tree'
import { test_titles, type TestEntry } from './test-titles'

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

interface TitleChanges extends Removal {
	added: ReadonlyArray<string>
}

function tests_in(api: TypeScriptApi, texts: ReadonlyArray<string>): ReadonlyArray<TestEntry> {
	return texts.flatMap((text) => test_titles.tests_of(api, text))
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

// The titles the change added, so a draft row can be met by the test that names its criterion
// (joshuafolkken/kit#5541).
function added_titles(
	before: ReadonlyArray<string>,
	after: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const held = new Set(before)

	return after.filter((title) => !held.has(title))
}

function title_changes(
	before: ReadonlyArray<TestEntry>,
	after: ReadonlyArray<TestEntry>,
): TitleChanges {
	const before_titles = before.map((entry) => entry.title)
	const after_titles = after.map((entry) => entry.title)
	const removed = removed_tests.removed(before_titles, after_titles)

	return {
		removed,
		renamed: renamed_tests.renamed(before, after, removed),
		added: added_titles(before_titles, after_titles),
	}
}

async function changes(): Promise<TitleChanges | undefined> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) return undefined
	const root = await git_command.repository_root()
	const api = review_code_tree.load_typescript(root)

	if (api === undefined) return { ...removed_tests.NONE, added: [] }
	const changed = await changed_paths.read_changed_since(base)
	const paths = changed.filter((relative) => test_declared_logic.is_test_file(relative))
	const before = tests_in(api, await base_texts(base, paths))

	return title_changes(before, tests_in(api, tree_texts(root, paths)))
}

async function read(): Promise<Removal | undefined> {
	return await changes()
}

// `josh ship`'s preflight asks the body it is about to deliver, so a missing disposition stops it
// before the review rather than at the merge.
async function body_refusal(pr_body: string | undefined): Promise<string | undefined> {
	const removal = await read()

	if (removal === undefined) return UNREADABLE_MESSAGE
	const left = removed_tests.undisposed(removal.removed, pr_body)

	return left.length === 0 ? undefined : removed_tests.refusal_message(left, removal.renamed)
}

async function refusal(branch_name: string): Promise<string | undefined> {
	return await body_refusal(await git_gh_command.pr_get_body(branch_name))
}

const removed_tests_check = { body_refusal, changes, read, refusal, UNREADABLE_MESSAGE }

export type { TitleChanges }
export { removed_tests_check }

export { type Removal } from './removed-tests'
