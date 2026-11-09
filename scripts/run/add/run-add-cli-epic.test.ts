import path from 'node:path'
import { EPIC_LABEL } from '#scripts/issue/issue-labels'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddPorts } from './run-add'
import { run_add_cli } from './run-add-cli'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6840: `run:add <E>` records an epic as a root of a live run, named or pool,
// without labelling it — an epic root carries no label for a pool run to read.

const scratch = make_directory('run-add-cli-epic-test-')
const GIT_DIRECTORY = path.join(scratch, 'repository.git')
const EPIC = 6835
const NAMED_INVOCATION = 'backlogrun #1762'
const POOL_INVOCATION = 'backlogrun'

const EPIC_PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, labels: [EPIC_LABEL], blockers: [] }),
	apply_label: async () => true,
	clear_label: async () => true,
}

function target(): string {
	return run_carry.carry_path(GIT_DIRECTORY)
}

function added_roots(): unknown {
	const read = run_carry.read_carry(target())

	return read.kind === 'carried' ? read.carry.added : []
}

beforeEach(() => {
	vi.spyOn(lane_spent, 'lanes_in_use').mockResolvedValue({ working: [], unread: [] })
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run with an epic', () => {
	it.each([NAMED_INVOCATION, POOL_INVOCATION])(
		'records it as a root of `%s`, unlabelled, and announces it',
		async (invocation) => {
			run_carry.begin_carry(target(), invocation, run_carry.NO_OWNER, new Date())
			const apply_label = vi.fn(EPIC_PORTS.apply_label)

			expect(await run_add_cli.run([String(EPIC)], { ...EPIC_PORTS, apply_label })).toBe(0)
			expect(added_roots()).toStrictEqual([{ issue: EPIC, is_priority: true }])
			expect(apply_label).not.toHaveBeenCalled()
			expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
				'add',
				'added #6835 · tracked as an epic root',
			)
			expect(console.info).toHaveBeenCalledWith('tracking #6835 · epic root, ahead of the queue')
		},
	)

	it.each([`backlogrun #${String(EPIC)}`, POOL_INVOCATION])(
		'answers that `%s` already tracks it, recording nothing twice',
		async (invocation) => {
			run_carry.begin_carry(target(), invocation, run_carry.NO_OWNER, new Date())
			await run_add_cli.run([String(EPIC)], EPIC_PORTS)
			const before = added_roots()

			vi.mocked(run_event_stream_emit.emit).mockClear()
			expect(await run_add_cli.run([String(EPIC)], EPIC_PORTS)).toBe(0)
			expect(added_roots()).toStrictEqual(before)
			expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
			expect(console.info).toHaveBeenLastCalledWith('tracking #6835 · already a root of this run')
		},
	)
})

describe('run with an epic and --no-priority', () => {
	it('puts the root at the end of the run, after its named list', async () => {
		run_carry.begin_carry(target(), NAMED_INVOCATION, run_carry.NO_OWNER, new Date())

		expect(await run_add_cli.run([String(EPIC), '--no-priority'], EPIC_PORTS)).toBe(0)
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([
			1762,
			EPIC,
		])
	})
})

describe('run_add_cli.USAGE', () => {
	it('says an epic is tracked as a root, not refused', () => {
		expect(run_add_cli.USAGE).toContain('an epic is tracked as a root')
	})
})
