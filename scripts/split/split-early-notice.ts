import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { split_assess } from './split-assess'
import { split_measure } from './split-measure'

// **The split notice, shown mid-implementation** (joshuafolkken/kit#4642). `josh main:merge` prints it
// only before the gate, when the run can no longer carve anything out; a lane that grew to 17 files met
// it 25 minutes in. The first `josh lint:related` or `josh test:related` after the branch's diff passes
// the guide prints the same notice — `split_assess.notice`, so the bar and the question are one
// definition — once per Issue: a marker in the work tree's git directory, created exclusively, records
// that it was shown. A diff under the guide leaves no marker, so the first crossing still prints.
// Advisory only: an unmeasurable diff or a branch with no Issue prints nothing.

const MARKER_PREFIX = 'josh-split-notice-'
const EXISTS_CODE = 'EEXIST'

async function marker_path(issue_number: number): Promise<string | undefined> {
	const [git_directory] = await git_command.git_directories()

	if (git_directory === undefined) return undefined

	return path.join(git_directory, `${MARKER_PREFIX}${String(issue_number)}`)
}

// Undefined once shown, so a later run skips the measurement — a diff against main and a read of
// every untracked file.
async function unclaimed_marker(issue_number: number): Promise<string | undefined> {
	const target = await marker_path(issue_number)

	return target === undefined || existsSync(target) ? undefined : target
}

function is_exists_error(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === EXISTS_CODE
}

// True only for the call that created the marker — the one that shows the notice.
async function claim(target: string): Promise<boolean> {
	try {
		await writeFile(target, '', { flag: 'wx' })

		return true
	} catch (error) {
		if (is_exists_error(error)) return false
		throw error
	}
}

async function pending_notice(): Promise<string | undefined> {
	const issue_number = git_branch.issue_from_branch(await git_command.branch())

	if (issue_number === undefined) return undefined
	const target = await unclaimed_marker(issue_number)

	if (target === undefined) return undefined
	const notice = split_assess.notice(await split_measure.read_branch())

	return notice !== undefined && (await claim(target)) ? notice : undefined
}

async function surface(): Promise<void> {
	try {
		const notice = await pending_notice()

		if (notice !== undefined) console.warn(`\n${notice}`)
	} catch {
		// Advisory: `josh main:merge` reports an unmeasurable diff before the gate.
	}
}

const split_early_notice = { MARKER_PREFIX, surface }

export { split_early_notice }
