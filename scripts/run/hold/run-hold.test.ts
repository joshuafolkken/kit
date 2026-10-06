import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_hold } from './run-hold'

// joshuafolkken/kit#1091: the guard's whole value is that it answers "this tree is taken" without a
// person watching, so the three answers the issue names are pinned here — held stops, free proceeds,
// and a second work tree of the same repository is never stopped by the first one's record.

const TEST_PREFIX = 'run-hold-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const MAIN_WORKTREE = path.join(scratch, '.git')
const LINKED_WORKTREE = path.join(scratch, '.git', 'worktrees', 'second')
const ISSUE = '1091'
const OTHER_ISSUE = '1090'
const HOUR_MS = 3_600_000
const RECORDED_AT = '2026-09-06T12:00:00.000Z'
const WRITER_PID = 4242

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
	rmSync(run_hold.hold_path(MAIN_WORKTREE), { force: true })
	rmSync(run_hold.hold_path(LINKED_WORKTREE), { force: true })
})

describe('the record is keyed to one work tree', () => {
	it('gives two work trees of one repository two different records', () => {
		expect(run_hold.hold_path(LINKED_WORKTREE)).not.toBe(run_hold.hold_path(MAIN_WORKTREE))
	})

	it('gives the same work tree the same record every time', () => {
		expect(run_hold.hold_path(MAIN_WORKTREE)).toBe(run_hold.hold_path(MAIN_WORKTREE))
	})
})

describe('claiming and releasing', () => {
	it('reads back nothing before anything claimed it', () => {
		expect(run_hold.read_hold(run_hold.hold_path(MAIN_WORKTREE)).kind).toBe('free')
	})

	it('reads back the claim it wrote, and leaves the other work tree free', () => {
		const target = run_hold.hold_path(MAIN_WORKTREE)

		run_hold.write_hold(target, ISSUE)

		const read = run_hold.read_hold(target)

		expect(read.kind).toBe('held')
		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(ISSUE)
		expect(run_hold.read_hold(run_hold.hold_path(LINKED_WORKTREE)).kind).toBe('free')
	})

	it('is free again once released', () => {
		const target = run_hold.hold_path(MAIN_WORKTREE)

		run_hold.write_hold(target, ISSUE)
		run_hold.release_hold(target)

		expect(run_hold.read_hold(target).kind).toBe('free')
	})

	it('releases a record that was never there', () => {
		expect(() => {
			run_hold.release_hold(run_hold.hold_path(LINKED_WORKTREE))
		}).not.toThrow()
	})
})

// Two sessions that both read a free tree must not both be told they took it, which is what a plain
// write would do — the incident reproduced by the guard meant to stop it.
describe('two claims racing for one tree', () => {
	it('lets exactly one exclusive claim through', () => {
		const target = run_hold.hold_path(MAIN_WORKTREE)

		run_hold.release_hold(target)

		expect(run_hold.create_hold(target, ISSUE)).toBe(true)
		expect(run_hold.create_hold(target, OTHER_ISSUE)).toBe(false)
	})

	it('leaves the winner’s record untouched when a second claim loses', () => {
		const target = run_hold.hold_path(MAIN_WORKTREE)

		run_hold.release_hold(target)
		run_hold.create_hold(target, ISSUE)
		run_hold.create_hold(target, OTHER_ISSUE)

		const read = run_hold.read_hold(target)

		expect(read.kind === 'held' ? read.hold.issue : undefined).toBe(ISSUE)
	})
})

// The classifier is where the guard can fall open, so each of its answers is fixed separately.
describe('classify', () => {
	const now = new Date(RECORDED_AT)
	const fresh = JSON.stringify({ issue: ISSUE, taken_at: now.toISOString(), pid: WRITER_PID })

	it('reads an absent record as free', () => {
		expect(run_hold.classify(undefined, now).kind).toBe('free')
	})

	it('reads a current record as held', () => {
		expect(run_hold.classify(fresh, now).kind).toBe('held')
	})

	it('reads a record older than the maximum age as stale', () => {
		const old = new Date(now.getTime() - (run_hold.HOLD_MAX_AGE_HOURS + 1) * HOUR_MS)
		const raw = JSON.stringify({ issue: ISSUE, taken_at: old.toISOString(), pid: WRITER_PID })

		expect(run_hold.classify(raw, now).kind).toBe('stale')
	})

	// joshuafolkken/kit#1802 cut run:progress's watcher bound to one hour; this expiry shares the
	// number but guards a different thing — an uncommitted tree held across a person's latency — so a
	// bulk replace of the eight must not have swept it along.
	it('keeps the run-record expiry at eight hours, distinct from the watcher bound', () => {
		expect(run_hold.HOLD_MAX_AGE_HOURS).toBe(8)
	})

	// It passes the schema — it is a string — so reading it as current would leave the tree held with
	// nothing left to expire it, which is the one state the expiry exists to make impossible.
	it('reads a record whose time is not a date as stale rather than current', () => {
		const raw = JSON.stringify({ issue: ISSUE, taken_at: 'whenever', pid: WRITER_PID })

		expect(run_hold.classify(raw, now).kind).toBe('stale')
	})

	it.each(['not json at all', '{"issue":1091}', '[]'])(
		'reads a record it cannot parse (%j) as unreadable rather than free',
		(raw) => {
			expect(run_hold.classify(raw, now).kind).toBe('unreadable')
		},
	)

	it('reads a record left by a foreign writer as unreadable rather than free', () => {
		const target = run_hold.hold_path(LINKED_WORKTREE)

		writeFileSync(target, 'clobbered')

		expect(run_hold.read_hold(target).kind).toBe('unreadable')

		rmSync(target, { force: true })
	})
})

// The stop has to be actionable without a person going to read the source: who holds it, when the
// record was written, and the one command that clears a stale one.
describe('the stop message', () => {
	const hold = { issue: ISSUE, taken_at: RECORDED_AT, pid: WRITER_PID }

	it.each([`#${ISSUE}`, hold.taken_at, String(hold.pid), run_hold.FORCE_RELEASE_COMMAND])(
		'names %j',
		(fragment) => {
			expect(run_hold.held_message(hold)).toContain(fragment)
		},
	)

	it('names an unnumbered run rather than inventing an issue number', () => {
		const unnumbered = { ...hold, issue: run_hold.UNNUMBERED_ISSUE }

		expect(run_hold.held_message(unnumbered)).toContain('an unnumbered run')
	})

	it.each([run_hold.unreadable_message(), run_hold.unknown_message()])(
		'refuses to read %#-th unreadable state as an idle tree',
		(message) => {
			expect(message).toContain('that is not "nothing is running here"')
		},
	)

	it('says why a stale record was replaced', () => {
		expect(run_hold.stale_message(hold)).toContain(String(run_hold.HOLD_MAX_AGE_HOURS))
	})
})

// joshuafolkken/kit#1799: which command a message names is the whole of the friction. A reader who is
// not the record's run is sent to the forced spelling; the run that wrote it is sent to its own.
describe('the ownership of a record', () => {
	const hold = { issue: ISSUE, taken_at: RECORDED_AT, pid: WRITER_PID }

	it('matches the run whose issue the record names', () => {
		expect(run_hold.is_own_hold(hold, ISSUE)).toBe(true)
	})

	it.each([OTHER_ISSUE, run_hold.UNNUMBERED_ISSUE])('does not match %j', (claimant) => {
		expect(run_hold.is_own_hold(hold, claimant)).toBe(false)
	})

	it("mirrors the claim's own spelling for a numbered run", () => {
		expect(run_hold.own_release_command(ISSUE)).toBe(`${run_hold.RELEASE_COMMAND} ${ISSUE}`)
	})

	it('leaves the bare spelling to the unnumbered run', () => {
		expect(run_hold.own_release_command(run_hold.UNNUMBERED_ISSUE)).toBe(run_hold.RELEASE_COMMAND)
	})

	it.each([run_hold.own_release_command(ISSUE), run_hold.FORCE_RELEASE_COMMAND])(
		'names %j when a release did not claim the tree',
		(command) => {
			expect(run_hold.foreign_release_message(hold)).toContain(command)
		},
	)

	// The reader here is the person whose own `halfrun` stop left the work in the tree, so the command
	// to hand them is that run's own — not the forced one, which teaches the wrong habit.
	it('sends the owner of an expired record over a dirty tree to its own release', () => {
		expect(run_hold.uncommitted_message(hold)).toContain(run_hold.own_release_command(ISSUE))
	})

	it('says whose record a forced release removed', () => {
		expect(run_hold.forced_release_message(hold)).toContain(`#${ISSUE}`)
	})
})
