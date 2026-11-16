import type { CarryRead } from '#scripts/run/carry/run-carry'
import { run_wake } from '#scripts/run/wake/run-wake'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#7672: the header draws the kit version the run's supervisor recorded as it
// started, read off its wake record — never the checkout's package.json, which a merge moves ahead.

const { ENDED_AT, arrange } = run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431 --only'
const KIT_VERSION = 'v1.2.3+4'
const ENDED = { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT }

afterEach(() => vi.restoreAllMocks())

describe('run_board_read.read_local — the kit version', () => {
	it('reads the kit version off the supervisor’s wake record', async () => {
		arrange(NONE, ENDED)
		vi.mocked(run_wake.read_wake).mockReturnValue({
			invocation: EPIC_RUN,
			started_at: STARTED_AT,
			pid: process.pid,
			woke: 0,
			kit_version: KIT_VERSION,
		})

		await expect(run_board_read.read_local()).resolves.toMatchObject({ kit_version: KIT_VERSION })
	})

	it('reads none where no supervisor recorded one', async () => {
		arrange(NONE, ENDED)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ kit_version: undefined })
	})
})
