import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import type { SplitNoticeRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_cut_budget_over } from '#scripts/run/cut/run-cut-budget-over'
import { split_assess, type DeclaredSize, type SizeMeasurement } from './split-assess'
import { split_measure } from './split-measure'

// **The split notice, shown mid-implementation** (joshuafolkken/kit#4642). `josh main:merge` prints it
// only before the gate, when the run can no longer carve anything out. The first
// `josh lint:related` or `josh test:related` after the branch's diff passes the bar (the Issue's
// declared size grown, capped at the guide) prints the same notice, `split_assess.notice`, so the bar
// and the question are one definition. Once per Issue: a marker in the work tree's git directory,
// created exclusively, records that it was shown. A diff under the bar leaves no marker, so the first
// crossing still prints. A diff under the bar still prints once the implementation runs past its
// stage budget (joshuafolkken/kit#6544), with the way out `run:cut`'s `budget-over` prints.
// Advisory only: an unmeasurable diff or a branch with no Issue prints nothing.

const MARKER_PREFIX = 'josh-split-notice-'
// The time bar's own once-per-Issue marker, so neither bar's showing silences the other.
const BUDGET_PREFIX = 'josh-split-budget-'
const BUDGET_REASON = 'budget'
const DECLARED_PREFIX = 'josh-split-declared-'
const EXISTS_CODE = 'EEXIST'

async function marker_path(issue_number: number, prefix: string): Promise<string | undefined> {
	const [git_directory] = await git_command.git_directories()

	if (git_directory === undefined) return undefined

	return path.join(git_directory, `${prefix}${String(issue_number)}`)
}

// Undefined once shown, so a later run skips the measurement — a diff against main and a read of
// every untracked file.
async function unclaimed_marker(issue_number: number, prefix: string): Promise<string | undefined> {
	const target = await marker_path(issue_number, prefix)

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
// line per Issue and bar, whichever command showed it (joshuafolkken/kit#4695).
async function claim_notice(target: string, notice: SplitNoticeRecord): Promise<boolean> {
	if (!(await claim(target))) return false
	await lane_ledger_write.record_split_notice(notice)

	return true
}

function record_of(issue: number, measurement: SizeMeasurement): SplitNoticeRecord {
	return { issue, files: measurement.files, lines: measurement.lines }
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

async function pending_size_notice(issue_number: number): Promise<string | undefined> {
	const target = await unclaimed_marker(issue_number, MARKER_PREFIX)

	if (target === undefined) return undefined
	const measurement = await split_measure.read_branch()
	const notice = split_assess.notice(measurement, await declared_of(issue_number))

	return notice !== undefined && (await claim_notice(target, record_of(issue_number, measurement)))
		? notice
		: undefined
}

// `budget-over`'s way out holds only with a green part to ship, which `run:cut` checks and this notice
// leaves to the reader.
function budget_text(issue_number: number, over: number): string {
	return `split notice: the implementation is ${String(over)} min over its stage budget — with an acceptance criterion this tree meets: ${run_cut_budget_over.spill_steps(String(issue_number))} With none met yet, go on.`
}

// The time bar does not depend on the diff, so an unmeasurable one is recorded as empty rather than
// silencing the notice.
async function budget_record(issue_number: number): Promise<SplitNoticeRecord> {
	try {
		return { ...record_of(issue_number, await split_measure.read_branch()), reason: BUDGET_REASON }
	} catch {
		return { issue: issue_number, files: 0, lines: 0, reason: BUDGET_REASON }
	}
}

// The time bar (joshuafolkken/kit#6544): a slow implementation crosses its budget with a small diff.
async function pending_budget_notice(issue_number: number): Promise<string | undefined> {
	const target = await unclaimed_marker(issue_number, BUDGET_PREFIX)

	if (target === undefined) return undefined
	const over = await run_cut_budget_over.implement_over(issue_number)

	if (over === undefined) return undefined
	const notice = await budget_record(issue_number)

	return (await claim_notice(target, notice)) ? budget_text(issue_number, over) : undefined
}

// `josh main:merge` prints its notice on every merge; this records the first showing, as the scoped
// checks do, when neither of them showed it before. Advisory, as `surface` is.
async function record(measurement: SizeMeasurement): Promise<void> {
	try {
		const issue_number = await branch_issue()
		const target =
			issue_number === undefined ? undefined : await unclaimed_marker(issue_number, MARKER_PREFIX)

		if (issue_number !== undefined && target !== undefined) {
			await claim_notice(target, record_of(issue_number, measurement))
		}
	} catch {
		// Advisory: the notice was printed; only its record is lost.
	}
}

async function show(
	pending: (issue_number: number) => Promise<string | undefined>,
	issue_number: number,
): Promise<void> {
	try {
		const notice = await pending(issue_number)

		if (notice !== undefined) console.warn(`\n${notice}`)
	} catch {
		// Advisory: `josh main:merge` reports an unmeasurable diff before the gate.
	}
}

// Each bar on its own, so an unmeasurable diff still lets the time bar print.
async function surface(): Promise<void> {
	try {
		const issue_number = await branch_issue()

		if (issue_number === undefined) return
		await show(pending_size_notice, issue_number)
		await show(pending_budget_notice, issue_number)
	} catch {
		// Advisory: a branch that cannot be read shows nothing.
	}
}

const split_early_notice = {
	BUDGET_PREFIX,
	DECLARED_PREFIX,
	MARKER_PREFIX,
	declared,
	record,
	surface,
}

export { split_early_notice }
