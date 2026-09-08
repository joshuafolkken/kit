import { mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_gh_issue_read } from '#scripts/git/git-gh-issue-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	ALIVE_VERDICT,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	PLATFORM_TEMP_ROOT,
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	run_liveness,
	SETTLED_VERDICT,
	STOPPED_VERDICT,
	UNDETERMINED_VERDICT,
	type LivenessRequest,
	type Traces,
} from './run-liveness'

// joshuafolkken/kit#1485. The four-trace conjunction joshuafolkken/kit#1212 wrote could not fire for
// a unit that stopped before implementing, because it required a dirty checkout. These are the cases
// the reading has to answer, and the one it must never get wrong: a live unit booked as stopped
// kills work that was in progress.

const ISSUE = '1169'
const TRANSCRIPT_NAME = 'transcript.jsonl'

function arrange_traces(overrides: Partial<Traces> = {}): Traces {
	return {
		is_child_settled: false,
		is_output_frozen: true,
		is_tree_dirty: false,
		process_trace: PROCESS_NONE,
		...overrides,
	}
}

describe('the stop a unit leaves, whether or not it reached the implementation', () => {
	// The measured case: the unit died seven minutes in, while still reading. The tree was clean, no
	// branch and no pull request existed, and the old conjunction therefore stayed false forever.
	it('detects a unit that stopped before it edited anything', () => {
		expect(run_liveness.decide(arrange_traces({ is_tree_dirty: false })).verdict).toBe(
			STOPPED_VERDICT,
		)
	})

	it('detects a unit that stopped in the middle of implementing', () => {
		expect(run_liveness.decide(arrange_traces({ is_tree_dirty: true })).verdict).toBe(
			STOPPED_VERDICT,
		)
	})

	// The dirty tree is no longer part of the test; it decides only whether there is work to stash
	// before the child is parked.
	it.each([
		[true, true],
		[false, false],
	])('asks for a stash only when the checkout is dirty: %j', (is_tree_dirty, expected) => {
		const decision = run_liveness.decide(arrange_traces({ is_tree_dirty }))

		expect(decision.has_work_to_stash).toBe(expected)
	})

	it('never asks for a stash on a verdict that is not a stop', () => {
		const traces = arrange_traces({ is_output_frozen: false, is_tree_dirty: true })

		expect(run_liveness.decide(traces)).toMatchObject({
			has_work_to_stash: false,
			verdict: ALIVE_VERDICT,
		})
	})
})

describe('a live unit is never booked as stopped', () => {
	it('answers alive while the output is still moving', () => {
		expect(run_liveness.decide(arrange_traces({ is_output_frozen: false })).verdict).toBe(
			ALIVE_VERDICT,
		)
	})

	// A `pnpm josh followup` waits on CI for up to 32 minutes and writes nothing while it
	// does, which is longer than the silent window. The process trace is what keeps that from reading
	// as a stop.
	it('answers alive while a process of the child is running a long check', () => {
		const traces = arrange_traces({ process_trace: PROCESS_ALIVE })

		expect(run_liveness.decide(traces).verdict).toBe(ALIVE_VERDICT)
	})

	// Output that moved needs nothing else to mean what it says, so it outranks a trace that could not
	// be read.
	it('answers alive on moving output even where another trace could not be read', () => {
		const traces = arrange_traces({ is_child_settled: undefined, is_output_frozen: false })

		expect(run_liveness.decide(traces).verdict).toBe(ALIVE_VERDICT)
	})

	// A live process does not, and this is the ordering round 2 corrected: a `pgrep` scoped too wide
	// over an output path that resolves to nothing would answer `alive` on every poll forever, and no
	// poll would ever say `undetermined` for the two-in-a-row bound to count.
	it('refuses to answer alive from a live process alone when the output could not be read', () => {
		const traces = arrange_traces({ is_output_frozen: undefined, process_trace: PROCESS_ALIVE })

		expect(run_liveness.decide(traces).verdict).toBe(UNDETERMINED_VERDICT)
	})

	// The last row is a process trace nobody gave: an unasked question, not an answer of "no process".
	it.each<Partial<Traces>>([
		{ is_child_settled: undefined },
		{ is_output_frozen: undefined },
		{ process_trace: PROCESS_UNKNOWN },
	])('answers undetermined rather than stopped when a trace could not be read: %j', (overrides) => {
		expect(run_liveness.decide(arrange_traces(overrides)).verdict).toBe(UNDETERMINED_VERDICT)
	})
})

describe('a child that no longer needs recovering', () => {
	// The unit may have finished, or parked the child, between the poll and this read. Either way the
	// loop's own branches own it, and booking a failure here would invent one.
	it('answers settled when the child closed or was parked', () => {
		expect(run_liveness.decide(arrange_traces({ is_child_settled: true })).verdict).toBe(
			SETTLED_VERDICT,
		)
	})

	it('prefers settled over a stop, so a finished child is never parked', () => {
		const traces = arrange_traces({ is_child_settled: true, is_tree_dirty: true })

		expect(run_liveness.decide(traces)).toMatchObject({
			has_work_to_stash: false,
			verdict: SETTLED_VERDICT,
		})
	})
})

const directories: Array<string> = []
const DIRECTORY_PREFIX = 'run-liveness-'
const FIRST_LINE = 'first\n'

// One temp directory per case, registered for the teardown that removes them all. The root is a
// parameter because the cases below deliberately sit under different ones: `os.tmpdir()` for the
// reads that only need somewhere to write, and the platform temp root for the two that exist to
// assert it is reachable at all (joshuafolkken/kit#1501).
function arrange_directory(root: string): string {
	const directory = mkdtempSync(path.join(root, DIRECTORY_PREFIX))

	directories.push(directory)

	return directory
}

function arrange_transcript(age_ms: number): { link: string; target: string } {
	const directory = arrange_directory(tmpdir())
	const target = path.join(directory, TRANSCRIPT_NAME)
	const link = path.join(directory, 'link.jsonl')

	writeFileSync(target, FIRST_LINE)
	symlinkSync(target, link)

	const seconds = (Date.now() - age_ms) / MS_PER_SECOND

	utimesSync(target, seconds, seconds)

	return { link, target }
}

async function is_frozen(output_path: string, gap_ms: number): Promise<boolean | undefined> {
	return await run_liveness.read_output_frozen({
		gap_ms,
		now_ms: Date.now(),
		output_path,
		silent_window_ms: MS_PER_MINUTE,
	})
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true })
	}
})

describe('the output read follows the symlink', () => {
	// The link's own modification time never moves after it is created, so a read that does not follow
	// it reports that creation time — the misread that had this parent report a dead unit as alive
	// twice.
	it('reads the age of the file the link points at', () => {
		const { link, target } = arrange_transcript(MS_PER_MINUTE)
		const through_link = run_liveness.sample_output(link)
		const oldest_fresh_ms = Date.now() - MS_PER_SECOND

		expect(through_link).toStrictEqual(run_liveness.sample_output(target))
		expect(through_link?.mtime_ms).toBeLessThan(oldest_fresh_ms)
	})

	it('reports a path that resolves to nothing as unreadable', () => {
		const absent = path.join(arrange_directory(tmpdir()), 'absent.jsonl')

		expect(run_liveness.sample_output(absent)).toBeUndefined()
	})

	// A relative path would resolve against whatever directory the caller ran from, which for a command
	// asked about another checkout is rarely the one meant — so it is refused rather than resolved.
	it.each([TRANSCRIPT_NAME, `./${TRANSCRIPT_NAME}`, `../${TRANSCRIPT_NAME}`])(
		'refuses the relative path %j',
		(relative) => {
			expect(run_liveness.sample_output(relative)).toBeUndefined()
		},
	)

	// The argument is composed by an agent rather than typed by a person, so a `stat` that could be
	// pointed anywhere would be an existence oracle for the whole file system.
	it.each(['/etc/hosts', '/etc/../etc/hosts'])(
		'refuses %j, which is under no allowed root',
		(outside) => {
			expect(run_liveness.sample_output(outside)).toBeUndefined()
		},
	)
})

// joshuafolkken/kit#1501. `os.tmpdir()` honors `TMPDIR`, which on macOS names a per-user
// `/var/folders/…/T` — so an agent harness writing under `/tmp` lands somewhere the old two-root list
// never named, every poll answered `undetermined`, and the parent could not detect a stopped unit at
// all. Both spellings are asserted because `/tmp` is a symbolic link to `/private/tmp` there and
// `path.relative` resolves no link; on Linux the two coincide and the pair degenerates to one case
// rather than becoming untrue.
function arrange_platform_transcript(): { resolved: string; written: string } {
	const directory = arrange_directory(PLATFORM_TEMP_ROOT)
	const written = path.join(directory, TRANSCRIPT_NAME)

	writeFileSync(written, FIRST_LINE)

	return { resolved: path.join(realpathSync(directory), TRANSCRIPT_NAME), written }
}

describe('the platform temp root, in both of its spellings', () => {
	it('reads a transcript written under the platform temp root', () => {
		expect(run_liveness.sample_output(arrange_platform_transcript().written)).toBeDefined()
	})

	// The measured failure: the path the harness reports is already resolved, so this is the spelling
	// that actually reached the command.
	it('reads the same transcript through its resolved spelling', () => {
		expect(run_liveness.sample_output(arrange_platform_transcript().resolved)).toBeDefined()
	})
})

describe('what counts as frozen', () => {
	it('calls a file written inside the silent window not frozen', async () => {
		const { link } = arrange_transcript(0)

		await expect(is_frozen(link, 0)).resolves.toBe(false)
	})

	it('calls a file silent past the window and unchanged across both samples frozen', async () => {
		const { link } = arrange_transcript(2 * MS_PER_MINUTE)

		await expect(is_frozen(link, 0)).resolves.toBe(true)
	})

	// The size comparison is the half that proved liveness by hand: an append inside the gap says the
	// unit is writing even where the timestamp granularity would have hidden it.
	it('calls a file that grew between the two samples not frozen', async () => {
		const { link, target } = arrange_transcript(2 * MS_PER_MINUTE)
		const pending = is_frozen(link, 20)

		writeFileSync(target, `${FIRST_LINE}second\n`)

		await expect(pending).resolves.toBe(false)
	})

	it('reports a file that disappeared between the samples as unreadable', async () => {
		const { link, target } = arrange_transcript(2 * MS_PER_MINUTE)
		const pending = is_frozen(link, 20)

		rmSync(target)

		await expect(pending).resolves.toBeUndefined()
	})
})

function arrange_issue(state: string, labels: ReadonlyArray<string>): void {
	const json = JSON.stringify({ labels: labels.map((name) => ({ name })), state })

	vi.spyOn(git_gh_issue_read, 'issue_view_json').mockResolvedValue(json)
}

// Round 2 named the gap: every settled test above passes an already-decided boolean, so the read that
// decides it could be edited back to the `in-progress` test — round 1's defect — with the suite green.
describe('what makes a child settled, read from GitHub', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each([
		['CLOSED', [], true],
		['OPEN', ['needs-decision'], true],
		['OPEN', ['in-progress'], false],
		// The unit applies `in-progress` itself, after it reads the issue — so a unit that stopped
		// before applying it leaves exactly this, and reading it as settled loses the stop.
		['OPEN', [], false],
	])('reads %s %j as settled=%j', async (state, labels, expected) => {
		arrange_issue(state, labels)

		await expect(run_liveness.read_child_settled(ISSUE)).resolves.toBe(expected)
	})

	it('answers undetermined rather than settled when the issue could not be read', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_view_json').mockResolvedValue(undefined)

		await expect(run_liveness.read_child_settled(ISSUE)).resolves.toBeUndefined()
	})
})

describe('the issue number is validated before anything is read', () => {
	it.each(['', 'abc', '0', '-1'])('refuses %j', async (issue) => {
		const request: LivenessRequest = { issue, output_path: 'x', process_trace: PROCESS_NONE }

		await expect(run_liveness.check(request)).rejects.toThrow('Not an issue number')
	})
})
