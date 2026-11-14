import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_wake_driver } from './run-wake-driver'

const make_directory = temporary_directory()

// joshuafolkken/kit#7506: a session woken beside the driver closes its retrospective on the record the
// supervisor holds. The supervisor's next pass claims that record again; a rewrite from its own read
// would race the close and drop the mark. Apart from `run-wake-driver.test.ts` for its line ceiling.

const INVOCATION = 'backlogrun --max 5'
const OUTPUT = 'merge over #2509\nresume: --owner 1'
// The pass reads the record twice before the claim writes: once to prepare, once to claim.
const READS_BEFORE_CLAIM = 2
const scratch = { target: '' }

beforeEach(() => {
	scratch.target = path.join(make_directory('josh-wake-driver-claim-'), 'carry.json')
	run_carry.begin_carry(scratch.target, INVOCATION)
	// The stage a claim writes goes to the checkout's own stream, which is a live run's: never from a test.
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: OUTPUT })
})

afterEach(() => {
	vi.restoreAllMocks()
})

function carried(): RunCarry {
	const read = run_carry.read_carry(scratch.target)

	if (read.kind !== 'carried') throw new Error('the scratch record is gone')

	return read.carry
}

test('keeps a retrospective a beside session marked after the pass read the record it holds', async () => {
	await run_wake_driver.drive(scratch.target)
	const stale = carried()

	run_carry.apply_change(scratch.target, stale, { retrospective: true })
	const reads = vi.spyOn(run_carry, 'read_carry')

	for (let read = 0; read < READS_BEFORE_CLAIM; read += 1) {
		reads.mockReturnValueOnce({ kind: 'carried', carry: stale })
	}

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'judgment' })
	reads.mockRestore()
	expect(carried()).toMatchObject({ owner_pid: process.pid, retrospective: true })
})
