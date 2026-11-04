import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { split_assess, type DeclaredSize, type SizeMeasurement } from './split-assess'
import { split_measure } from './split-measure'

// **The split notice, shown mid-implementation** (joshuafolkken/kit#4642). `josh main:merge` prints it
// only before the gate, when the run can no longer carve anything out. The first
// `josh lint:related` or `josh test:related` after the branch's diff passes the bar (the Issue's
// declared size grown, capped at the guide) prints the same notice, `split_assess.notice`, so the bar
// and the question are one definition. Once per Issue: a marker in the work tree's git directory,
// created exclusively, records that it was shown. A diff under the bar leaves no marker, so the first
// crossing still prints.
// Advisory only: an unmeasurable diff or a branch with no Issue prints nothing.

const MARKER_PREFIX = 'josh-split-notice-'
const DECLARED_PREFIX = 'josh-split-declared-'
const EXISTS_CODE = 'EEXIST'

async function marker_path(issue_number: number, prefix: string): Promise<string | undefined> {
	const [git_directory] = await git_command.git_directories()

	if (git_directory === undefined) return undefined

	return path.join(git_directory, `${prefix}${String(issue_number)}`)
}

// Undefined once shown, so a later run skips the measurement — a diff against main and a read of
// every untracked file.
async function unclaimed_marker(issue_number: number): Promise<string | undefined> {
	const target = await marker_path(issue_number, MARKER_PREFIX)

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

// The claim that shows the notice first also writes it to the lane ledger, so the ledger holds one
// line per Issue, whichever command showed it (joshuafolkken/kit#4695).
async function claim_notice(
	target: string,
	issue: number,
	measurement: SizeMeasurement,
): Promise<boolean> {
	if (!(await claim(target))) return false
	await lane_ledger_write.record_split_notice({
		issue,
		files: measurement.files,
		lines: measurement.lines,
	})

	return true
}

async function branch_issue(): Promise<number | undefined> {
	return git_branch.issue_from_branch(await git_command.branch())
}

function parse_declared(text: string): DeclaredSize | undefined {
	const [files, lines] = text.split(' ').map(Number)

	return files === undefined || lines === undefined ? undefined : { files, lines }
}

// The declaration read once per Issue and kept beside the marker, so a scoped check under the bar
// does not read the Issue on every run; a read that throws is not kept, and the next run reads again.
async function read_and_keep(
	issue_number: number,
	target: string,
): Promise<DeclaredSize | undefined> {
	const read = await issue_declared_size.read(String(issue_number))

	await writeFile(target, read === undefined ? '' : `${String(read.files)} ${String(read.lines)}`)

	return read
}

async function declared_of(issue_number: number): Promise<DeclaredSize | undefined> {
	try {
		const target = await marker_path(issue_number, DECLARED_PREFIX)

		if (target === undefined) return await issue_declared_size.read(String(issue_number))
		if (existsSync(target)) return parse_declared(await readFile(target, 'utf8'))

		return await read_and_keep(issue_number, target)
	} catch {
		return undefined
	}
}

// The branch Issue's declared size, which the notice's bar grows from (joshuafolkken/kit#6206). An
// unreadable Issue, or a branch with none, falls back to the guide rather than failing the notice.
async function declared(): Promise<DeclaredSize | undefined> {
	const issue_number = await branch_issue()

	return issue_number === undefined ? undefined : await declared_of(issue_number)
}

async function pending_notice(): Promise<string | undefined> {
	const issue_number = await branch_issue()

	if (issue_number === undefined) return undefined
	const target = await unclaimed_marker(issue_number)

	if (target === undefined) return undefined
	const measurement = await split_measure.read_branch()
	const notice = split_assess.notice(measurement, await declared_of(issue_number))

	return notice !== undefined && (await claim_notice(target, issue_number, measurement))
		? notice
		: undefined
}

// `josh main:merge` prints its notice on every merge; this records the first showing, as the scoped
// checks do, when neither of them showed it before. Advisory, as `surface` is.
async function record(measurement: SizeMeasurement): Promise<void> {
	try {
		const issue_number = await branch_issue()
		const target = issue_number === undefined ? undefined : await unclaimed_marker(issue_number)

		if (issue_number !== undefined && target !== undefined) {
			await claim_notice(target, issue_number, measurement)
		}
	} catch {
		// Advisory: the notice was printed; only its record is lost.
	}
}

async function surface(): Promise<void> {
	try {
		const notice = await pending_notice()

		if (notice !== undefined) console.warn(`\n${notice}`)
	} catch {
		// Advisory: `josh main:merge` reports an unmeasurable diff before the gate.
	}
}

const split_early_notice = { DECLARED_PREFIX, MARKER_PREFIX, declared, record, surface }

export { split_early_notice }
