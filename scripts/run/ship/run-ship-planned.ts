import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_branch } from '#scripts/git/git-branch'
import { git_issue } from '#scripts/git/git-issue'
import { lane_plan, type LanePlan } from '#scripts/lane/lane-plan'
import { test_declared_logic } from '#scripts/test/test-declared-logic'

// `josh ship`'s `planned` precondition (joshuafolkken/kit#5152): the branch's code files that the
// lane's `lane:plan` record never listed. Nothing else compares a lane's edits with its plan, so an
// out-of-scope fix landed with no one noticing (joshuafolkken/kit#5122). Tests, documents and data
// files (a `cspell.config.yaml` term, a lock file) never count, and a branch with no plan record, or a
// yielded one — a `fullrun` a person drove — passes as before.

const SEPARATOR = '/'
const NON_CODE_PREFIXES = ['docs/', '.josh/']
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.sh', '.svelte', '.ts'])

// A claim ending in `/` is a directory and holds every path under it — `backlog_overlap`'s reading.
function is_planned(claims: ReadonlyArray<string>, file: string): boolean {
	return claims.some((claim) =>
		claim.endsWith(SEPARATOR) ? file.startsWith(claim) : claim === file,
	)
}

function is_code(file: string): boolean {
	return (
		CODE_EXTENSIONS.has(path.extname(file)) &&
		NON_CODE_PREFIXES.every((prefix) => !file.startsWith(prefix))
	)
}

// The code files of `changed` that `claims` does not hold.
function unplanned_of(
	claims: ReadonlyArray<string>,
	changed: ReadonlyArray<string>,
): Array<string> {
	return test_declared_logic
		.runtime_files(changed)
		.filter((file) => is_code(file) && !is_planned(claims, file))
}

// The two ways out, each named with its command: the re-run replaces the record, so it lists the
// planned paths as well as the new ones.
function problem_text(
	issue: string,
	claims: ReadonlyArray<string>,
	files: ReadonlyArray<string>,
): string {
	const replan = ['pnpm josh lane:plan', issue, ...claims, ...files].join(' ')

	return `unplanned: ${files.join(', ')} — the lane's lane:plan record does not list these code files. In scope: run \`${replan}\` and comment the reason on the Issue in one line, then re-detach; if it answers \`yield\`, another lane holds the file — follow what it prints instead. Out of scope: revert the change and file it with \`pnpm josh issue:file\`.`
}

// A yielded plan outlives its lane on purpose (`lane-plan.ts`) and cleared no edit, so it reads as none.
function held_claims(plan: LanePlan | undefined): ReadonlyArray<string> | undefined {
	return plan?.yielded === true ? undefined : plan?.paths
}

async function problems(): Promise<Array<string>> {
	const issue = git_issue.branch_number(await git_branch.current())

	if (issue === undefined) return []
	const claims = held_claims(lane_plan.read(Number(issue), process.cwd()))

	if (claims === undefined) return []
	const files = unplanned_of(claims, await changed_paths.read_changed_paths(false))

	return files.length === 0 ? [] : [problem_text(issue, claims, files)]
}

const run_ship_planned = { problems, unplanned_of }

export { run_ship_planned }
