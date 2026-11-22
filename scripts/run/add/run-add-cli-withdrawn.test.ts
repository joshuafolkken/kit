import { rmSync } from 'node:fs'
import path from 'node:path'
import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddPorts } from './run-add'
import { run_add_cli } from './run-add-cli'

// joshuafolkken/kit#8599: an issue a person withdrew from the live run (`lane:withdraw`) goes back in
// only on an explicit `run:add <N> --retry`, as a new attempt the offer reads again; a bare `run:add`
// asks for `--retry`, and a merge stays refused.

const make_directory = temporary_directory('suite')
const scratch = make_directory('run-add-cli-withdrawn-test-')
const GIT_DIRECTORY = path.join(scratch, 'repository.git')
const ISSUE = '8353'
const INVOCATION = 'backlogrun #8353 --only'
const RETRY_FLAG = '--retry'
const WITHDRAWN_FLAG = '--withdrawn'
const RETRY_ARGS = [ISSUE, RETRY_FLAG]
const REASON = 'on hold'
const CARRY = run_carry.carry_path(GIT_DIRECTORY)
const CHILD_LAUNCH = 'child-launch'

const OPEN_PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, blockers: [] }),
	apply_label: async () => true,
	clear_label: async () => true,
}

function stream(): string {
	return run_event_stream.target_of(GIT_DIRECTORY)
}

function is_offer_excluded(): boolean {
	const events = run_event_stream.read_events(stream())

	return backlog_drive_restore.offer_exclude(events).includes(ISSUE)
}

function withdrawn(...settled: ReadonlyArray<string>): void {
	const at = new Date().toISOString()

	run_carry.begin_carry(CARRY, INVOCATION, run_carry.NO_OWNER, new Date())
	run_event_stream.append(stream(), CHILD_LAUNCH, `#${ISSUE} dispatched`, at)
	run_event_stream.append(stream(), 'withdraw', `#${ISSUE} withdrawn by a person: ${REASON}`, at)

	for (const kind of settled) run_event_stream.append(stream(), kind, `#${ISSUE} settled`, at)

	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue(
		run_event_stream.read_events(stream()),
	)
}

beforeEach(() => {
	vi.spyOn(lane_spent, 'lanes_in_use').mockResolvedValue({ working: [], unread: [] })
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(stream())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	run_carry.end_carry(CARRY)
	rmSync(stream(), { force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run:add — an issue a person withdrew from the live run', () => {
	it('re-admits it on --retry, so the offer reads it again', async () => {
		withdrawn()
		expect(is_offer_excluded()).toBe(true)

		expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(0)
		expect(console.info).toHaveBeenCalledWith(`queued #${ISSUE} · next free lane`)
		expect(is_offer_excluded()).toBe(false)
	})

	it('asks for --retry on a bare run:add and leaves it withdrawn', async () => {
		withdrawn()
		const apply_label = vi.fn(OPEN_PORTS.apply_label)

		expect(await run_add_cli.run([ISSUE], { ...OPEN_PORTS, apply_label })).toBe(1)
		expect(console.info).toHaveBeenCalledWith(`refused #${ISSUE} · use --retry`)
		expect(apply_label).not.toHaveBeenCalled()
	})

	it('still refuses a withdrawn issue whose later launch merged', async () => {
		withdrawn(CHILD_LAUNCH, 'merge')

		expect(await run_add_cli.run(RETRY_ARGS, OPEN_PORTS)).toBe(1)
		expect(console.info).toHaveBeenCalledWith(`refused #${ISSUE} · not a mechanical stop`)
	})
})

// joshuafolkken/kit#8619: `--retry --withdrawn` stands for every such issue, each line with its reason.
describe('run:add --retry --withdrawn', () => {
	it('re-admits each withdrawn issue with its withdrawal reason', async () => {
		withdrawn()

		expect(await run_add_cli.run([RETRY_FLAG, WITHDRAWN_FLAG], OPEN_PORTS)).toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			`queued #${ISSUE} · next free lane · withdrawn: ${REASON}`,
		)
		expect(is_offer_excluded()).toBe(false)
	})

	it('writes nothing and says so in one line when no issue is withdrawn', async () => {
		run_carry.begin_carry(CARRY, INVOCATION, run_carry.NO_OWNER, new Date())
		const apply_label = vi.fn(OPEN_PORTS.apply_label)

		expect(
			await run_add_cli.run([RETRY_FLAG, WITHDRAWN_FLAG], { ...OPEN_PORTS, apply_label }),
		).toBe(0)
		expect(console.info).toHaveBeenCalledExactlyOnceWith(
			'No withdrawn issue in this backlogrun; nothing was added.',
		)
		expect(apply_label).not.toHaveBeenCalled()
		expect(run_event_stream.read_events(stream())).toStrictEqual([])
	})

	it.each([[[WITHDRAWN_FLAG]], [[WITHDRAWN_FLAG, ISSUE, RETRY_FLAG]]])(
		'prints the usage and exits 2 for %j',
		async (argv) => {
			vi.spyOn(console, 'error').mockImplementation(vi.fn())

			expect(await run_add_cli.run(argv, OPEN_PORTS)).toBe(2)
			expect(console.error).toHaveBeenCalledWith(run_add_cli.USAGE)
			expect(run_add_cli.USAGE).toContain(`${RETRY_FLAG} ${WITHDRAWN_FLAG}`)
		},
	)
})

describe('run:add --retry --withdrawn — every withdrawn issue refused', () => {
	it('keeps the withdrawal reason on the refusal line', async () => {
		withdrawn()
		const closed: AddPorts = {
			...OPEN_PORTS,
			read_issue: async () => ({ is_open: false, blockers: [] }),
		}

		expect(await run_add_cli.run([RETRY_FLAG, WITHDRAWN_FLAG], closed)).toBe(1)
		expect(console.info).toHaveBeenCalledWith(expect.stringMatching(` · withdrawn: ${REASON}$`))
	})
})
