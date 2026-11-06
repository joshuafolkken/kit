import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_capacity } from './lane-capacity'
import { lane_ledger } from './lane-ledger'
import { lane_limit_cli, type LimitPorts } from './lane-limit-cli'
import { lane_limit_history } from './lane-limit-history'
import { lane_limit_override } from './lane-limit-override'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6166: a run started under one `JOSH_LANE_LIMIT` returns to it on `lane:limit
// --reset`, though the shell's `.env` reads another by then — the ledger and the status line alike.
// The carry record is a real one, keyed on a repository of the test's own.

const LAUNCH_LIMIT = 3
const EDITED_LIMIT = 4
const OVERRIDE_LIMIT = 5
const IN_USE = 1

const scratch = make_directory('lane-limit-reset-')
const LEDGER = path.join(scratch, 'ledger.jsonl')
const run = { repository: '' }

function carry_target(): string {
	return run_carry.carry_path(run.repository)
}

function ports(): LimitPorts {
	return {
		read_limit: async () => await lane_capacity.lane_limit(),
		read_override: lane_limit_override.read_override,
		write_override: lane_limit_override.write_override,
		emit_raise: vi.fn(async () => undefined),
		record_limit: async () => {
			await lane_limit_history.record_current(LEDGER)
		},
		lane_use: async () => ({ occupied: IN_USE, seated: IN_USE, unknown: [] }),
	}
}

async function limit_command(argv: ReadonlyArray<string>): Promise<string> {
	const spy = vi.spyOn(console, 'info').mockImplementation(vi.fn())

	await lane_limit_cli.run(argv, ports())

	const output = spy.mock.calls.flat().join('\n')

	spy.mockRestore()

	return output
}

beforeEach(() => {
	run.repository = `/lane-limit-reset-test/${randomUUID()}`
	rmSync(LEDGER, { force: true })
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(run.repository)
	vi.spyOn(run_carry, 'is_owner_live').mockReturnValue(true)
	run_carry.begin_carry(carry_target(), 'backlogrun')
	vi.stubEnv(lane_capacity.LANE_LIMIT_KEY, String(LAUNCH_LIMIT))
})

afterEach(() => {
	run_carry.end_carry(carry_target())
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('lane:limit --reset after the .env moved', () => {
	it('records and shows the limit the run started under, not the edited one', async () => {
		await lane_limit_history.record_launch(LEDGER)
		vi.stubEnv(lane_capacity.LANE_LIMIT_KEY, String(EDITED_LIMIT))

		await limit_command([String(OVERRIDE_LIMIT)])
		const status = await limit_command(['--reset'])
		const limits = lane_ledger
			.read_entries(LEDGER)
			.map((entry) => entry.kind === 'limit' && entry.limit)

		expect(limits).toStrictEqual([LAUNCH_LIMIT, OVERRIDE_LIMIT, LAUNCH_LIMIT])
		expect(status).toBe('lane limit 3 (JOSH_LANE_LIMIT) · in use 1 · free 2')
	})

	it('reads the edited .env once no run carries a start limit', async () => {
		vi.stubEnv(lane_capacity.LANE_LIMIT_KEY, String(EDITED_LIMIT))

		await expect(lane_capacity.lane_limit()).resolves.toStrictEqual({
			kind: 'limit',
			limit: EDITED_LIMIT,
		})
	})
})
