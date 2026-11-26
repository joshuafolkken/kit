import type { BusyRead } from '#scripts/epic/epic-busy'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_named_gate, type NamedPlain } from './backlog-drive-named-gate'
import { backlog_drive_named_scope } from './backlog-drive-named-scope'
import type { Declared } from './backlog-overlap'

// joshuafolkken/kit#8953: the named issues run side by side, so they pass the pool's `run:solo` hold
// and path-overlap separation before they launch.

const REPO = 'joshuafolkken/kit'
const RUNNING = 3
const PLAIN = 10
const OTHER = 11
const SHARED_PATH = 'scripts/lane/lane-overrun.ts'
const RUNNING_ISSUE: OpenIssueData = {
	number: RUNNING,
	title: 'running',
	createdAt: '2026-11-25T00:00:00Z',
	blockedBy: undefined,
	labels: [{ name: 'in-progress' }],
}
const BUSY: BusyRead = { kind: 'busy', issues: [RUNNING_ISSUE] }
const IDLE: BusyRead = { kind: 'idle' }

function plain(number: number, labels: ReadonlyArray<string> = []): NamedPlain {
	return { number, labels }
}

function scope_of(read: BusyRead, declared: Declared = new Map()): void {
	vi.spyOn(backlog_drive_named_scope, 'read').mockResolvedValue({
		read,
		repo: REPO,
		declared,
		lanes: new Map(),
	})
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named_gate.admitted', () => {
	it('admits every plain issue in the typed order when nothing holds them', async () => {
		scope_of(IDLE)

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN), plain(OTHER)], [])).toStrictEqual(
			[PLAIN, OTHER],
		)
	})

	it('withholds a run:solo issue while a lane is busy', async () => {
		scope_of(BUSY)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN, ['run:solo']), plain(OTHER)],
			[String(RUNNING)],
		)

		expect(admitted).not.toContain(PLAIN)
	})

	it('withholds an issue declaring a path a running lane declares', async () => {
		const shared = new Set([SHARED_PATH])

		scope_of(
			BUSY,
			new Map([
				[RUNNING, shared],
				[PLAIN, shared],
			]),
		)

		const admitted = await backlog_drive_named_gate.admitted(
			[plain(PLAIN), plain(OTHER)],
			[String(RUNNING)],
		)

		expect(admitted).toStrictEqual([OTHER])
	})
})

describe('backlog_drive_named_gate.admitted — nothing to gate', () => {
	it('admits none when the repository is unreadable', async () => {
		vi.spyOn(backlog_drive_named_scope, 'read').mockResolvedValue(undefined)

		expect(await backlog_drive_named_gate.admitted([plain(PLAIN)], [])).toStrictEqual([])
	})

	it('reads nothing for no plain issue', async () => {
		const read = vi.spyOn(backlog_drive_named_scope, 'read')

		expect(await backlog_drive_named_gate.admitted([], [])).toStrictEqual([])
		expect(read).not.toHaveBeenCalled()
	})
})
