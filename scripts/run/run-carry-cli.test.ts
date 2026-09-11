import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#1714. Two things are pinned here that prose alone would let a rewrite lose:
// standard output is one token on every path, and `--begin` never starts a second budget over a
// record that is already there.
//
// joshuafolkken/kit#1722 pins which answer each of the three standing-record cases gets: `busy` while
// the owner runs, `standing` for the same invocation retyped over a record no cut handed off, and
// `resumed` only for a cut the run itself declared or an adoption the reader asked for.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const { DEAD_PID, has_start_probe } = process_identity_fixture

const TEST_PREFIX = 'run-carry-cli-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const OTHER_INVOCATION = 'backlogrun --max 10 --idle 30'
const LONG_AGO = new Date(Date.now() - run_carry.CARRY_MAX_AGE_MS * 2)
const START = new Date('2026-09-11T00:00:00.000Z')
// The opening list, pinned: it is what a `queue` writes to `--begin` at every cut, including the one
// the successor makes (joshuafolkken/kit#1774).
const QUEUE = 'queue #1762 #1749 #1759'

// What `--json` puts on standard output. Only the two fields these tests read are named: `remaining`
// is the answer a resumed queue acts on, and `started_at` is what says the whole-run bound was not
// restarted by the resumption.
interface CarryJson {
	carry?: { started_at?: string }
	remaining?: ReadonlyArray<number>
}

const out: Array<string> = []
const errors: Array<string> = []

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

function last_json(): CarryJson {
	return JSON.parse(out.at(-1) ?? '{}') as CarryJson
}

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation((text: string) => {
		errors.push(text)
	})
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the record is keyed to the repository rather than the work tree', () => {
	it('reads none before anything has begun', async () => {
		expect(await run_carry_cli.run([])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})
})

describe('beginning a run', () => {
	it('answers began the first time', async () => {
		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.BEGAN_VERDICT])
	})
})

describe('who a standing record belongs to', () => {
	// The headline defect of joshuafolkken/kit#1722: the string matched, so the fresh session used to
	// inherit the dead run's counters and a `started_at` hours old.
	it('answers standing when the same invocation is typed again, leaving the record alone', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		const first = run_carry.read_carry(target())

		out.length = 0
		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(1)

		expect(out).toStrictEqual([run_carry_cli.STANDING_VERDICT])
		expect(run_carry.read_carry(target())).toStrictEqual(first)
	})

	it.skipIf(!has_start_probe)('answers busy while the owner is still running', async () => {
		await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(process.pid)])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(DEAD_PID)])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.BUSY_VERDICT])
	})

	it('answers resumed once a cut has declared the hand-off', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '2'])
		await run_carry_cli.run(['--cut'])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.RESUMED_VERDICT])
	})
})

describe('beginning a run over a record that is already there', () => {
	it('replaces a record whose whole-run bound is spent', async () => {
		run_carry.begin_carry(target(), INVOCATION, run_carry.NO_OWNER, LONG_AGO)

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.BEGAN_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('carried')
	})

	// The bound ends *that* run. Replacing a spent record a live parent is still counting into would
	// delete its budget and answer `began` — the two-parents defect, one branch over.
	it.skipIf(!has_start_probe)('refuses a spent record whose owner is still running', async () => {
		run_carry.begin_carry(target(), INVOCATION, run_carry.owner_of(process.pid), LONG_AGO)

		expect(await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(DEAD_PID)])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.BUSY_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('expired')
	})

	// A hand-off makes the resumption the same run, so its spent bound is this session's. Replaced
	// here, `started_at` would come back as now and `backlog:budget --started` would never end the run.
	it('answers expired for a spent record its own cut handed off, keeping its start time', async () => {
		const spent = run_carry.fresh_carry(INVOCATION, run_carry.NO_OWNER, LONG_AGO)

		run_carry.apply_change(target(), spent, { cuts: 1 })

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.EXPIRED_VERDICT])
		expect(run_carry.read_carry(target())).toMatchObject({
			carry: { started_at: LONG_AGO.toISOString() },
		})
	})

	// `--end` is only reached on the clean-finish path, so a crashed run leaves its record standing.
	// Resuming into it would spend that run's `--max` and its hours, not this invocation's.
	it('refuses a standing record belonging to a different invocation', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', OTHER_INVOCATION])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.MISMATCH_VERDICT])
	})
})

describe('adopting a standing record', () => {
	it('carries the budget the crashed run had spent', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '2', '--filed', '1'])
		out.length = 0

		expect(await run_carry_cli.run(['--resume', INVOCATION])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.RESUMED_VERDICT])
		expect(run_carry.read_carry(target())).toMatchObject({
			carry: { merged: 2, filed: 1 },
		})
	})

	it('refuses when nothing is carried, rather than beginning one', async () => {
		expect(await run_carry_cli.run(['--resume', INVOCATION])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('none')
	})

	it('refuses a record belonging to a different invocation', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		expect(await run_carry_cli.run(['--resume', OTHER_INVOCATION])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.MISMATCH_VERDICT])
	})
})

describe('counting into a carried run', () => {
	it('accumulates a merge, a filing and a cut', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '1', '--filed', '2'])
		await run_carry_cli.run(['--cut'])

		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? read.carry : undefined).toMatchObject({
			merged: 1,
			filed: 2,
			cuts: 1,
		})
	})

	it('refuses a count with no record to count into', async () => {
		expect(await run_carry_cli.run(['--merged', '1'])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})

	// A wave that merged nothing still reports a count, and the record it counts into is either there
	// or it is not — reading the zero as a bare read would answer `none` with exit 0.
	it('treats a zero increment as a count, so a missing record still exits non-zero', async () => {
		expect(await run_carry_cli.run(['--merged', '0'])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.NONE_VERDICT])
	})

	it('answers expired once the bound is spent, without losing the count', async () => {
		run_carry.begin_carry(target(), INVOCATION, run_carry.NO_OWNER, LONG_AGO)

		expect(await run_carry_cli.run(['--merged', '1'])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.EXPIRED_VERDICT])
	})
})

describe('reading the record back after a cut', () => {
	it('prints the whole record as one JSON line', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		await run_carry_cli.run(['--json'])

		expect(out).toHaveLength(1)
		expect(JSON.parse(out[0] ?? '')).toMatchObject({
			verdict: run_carry_cli.CARRIED_VERDICT,
			carry: { invocation: INVOCATION, merged: 0, cuts: 0 },
		})
	})
})

describe('ending a run', () => {
	it('clears the record and answers ended', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0

		expect(await run_carry_cli.run(['--end'])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.ENDED_VERDICT])
		expect(run_carry.read_carry(target()).kind).toBe('none')
	})
})

describe('an invocation the command cannot act on', () => {
	it.each([
		['two groups at once', ['--begin', INVOCATION, '--end']],
		['a count that is not a number', ['--merged', 'lots']],
		['a done that is not an issue number', ['--done', 'lots']],
		['a done naming issue zero', ['--done', '0']],
		['a done past the safe integer range', ['--done', '99999999999999999999']],
		['an unknown flag', ['--nope']],
		['a begin with no invocation text', ['--begin', '']],
		['a resume with no invocation text', ['--resume', '']],
		['a begin and a resume at once', ['--begin', INVOCATION, '--resume', INVOCATION]],
		['an owner that is not a pid', ['--begin', INVOCATION, '--owner', 'me']],
		['an owner that is a process group', ['--begin', INVOCATION, '--owner', '0']],
	])('refuses %s', async (_name, argv) => {
		expect(await run_carry_cli.run(argv)).toBe(1)
		expect(errors).toContain(run_carry_cli.USAGE)
	})

	it('answers unknown when the git directory cannot be read', async () => {
		git_directories.mockRejectedValue(new Error('no git'))

		expect(await run_carry_cli.run([])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.UNKNOWN_VERDICT])
	})
})

// joshuafolkken/kit#1774: the end-to-end shape a resumed `queue` rests on. The invocation string is
// the **opening** list at every step — that is the whole design, and the reason `--begin` answers
// `resumed` here rather than the `mismatch` a shrinking list would have produced.
describe('a queue carried across a session cut', () => {
	it('resumes on the opening list and reports only what is left', async () => {
		await run_carry_cli.run(['--begin', QUEUE])
		await run_carry_cli.run(['--merged', '1', '--done', '1762'])
		await run_carry_cli.run(['--cut'])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', QUEUE])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.RESUMED_VERDICT])

		await run_carry_cli.run(['--json'])

		expect(last_json().remaining).toStrictEqual([1749, 1759])
	})

	// The whole-run bound belongs to the record, so the resumption keeps the start the first session
	// wrote rather than beginning the eight hours again.
	it('keeps the start time the first session recorded', async () => {
		run_carry.begin_carry(target(), QUEUE, run_carry.NO_OWNER, START)
		await run_carry_cli.run(['--cut'])
		await run_carry_cli.run(['--begin', QUEUE])
		out.length = 0
		await run_carry_cli.run(['--json'])

		expect(last_json().carry?.started_at).toBe(START.toISOString())
	})

	// A crash never reaches `--cut`, so the successor is refused and a person decides — the same answer
	// `backlogrun` gets, and the reason `--cut` is the session's last write.
	it('stands rather than resumes when no cut declared the hand-off', async () => {
		await run_carry_cli.run(['--begin', QUEUE])
		await run_carry_cli.run(['--done', '1762'])
		out.length = 0

		expect(await run_carry_cli.run(['--begin', QUEUE])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.STANDING_VERDICT])
	})

	// A `backlogrun` record has no issue list, so the key is absent rather than empty.
	it('reports nothing for an invocation that declared no issues', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		out.length = 0
		await run_carry_cli.run(['--json'])

		expect(last_json().remaining).toBeUndefined()
	})
})
