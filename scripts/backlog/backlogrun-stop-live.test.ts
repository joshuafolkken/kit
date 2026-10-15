import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_registry } from '#scripts/lane/lane-registry'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_carry_stash } from '#scripts/run/carry/run-carry-stash'
import { run_merge_collect } from '#scripts/run/merge/run-merge-collect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlogrun_stop } from './backlogrun-stop'

// joshuafolkken/kit#3708: the stop as it is wired to the real stops, which `backlogrun-stop.test.ts`
// replaces with ports — a record a person ended is kept as a stopped run, and pushes no confirmation
// to the person who typed it.

const scratch = mkdtempSync(path.join(tmpdir(), 'backlogrun-stop-live-test-'))
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const NOW = new Date('2026-10-12T09:00:00.000Z')

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([])
	vi.spyOn(run_carry_stash, 'report_orphans').mockResolvedValue()
	vi.spyOn(run_merge_collect, 'collect_merged').mockResolvedValue()
	vi.spyOn(telegram_notify, 'confirm').mockResolvedValue(true)
	stamp_file.write_stamp(carry_target(), run_carry.fresh_carry(INVOCATION, {}, NOW))
})

afterAll(() => {
	run_carry.end_carry(carry_target())
	rmSync(run_carry_ended.ended_path(REPOSITORY), { force: true })
	rmSync(scratch, { recursive: true, force: true })
})

describe('backlogrun_stop.stop — wired to the real stops', () => {
	it('ends a record left behind and keeps it as a run a person stopped', async () => {
		const report = await backlogrun_stop.stop(REPOSITORY)

		expect(report).toStrictEqual({
			supervisor: undefined,
			parent: undefined,
			session: undefined,
			record: { kind: 'ended' },
			lanes: [],
		})
		expect(run_carry.read_carry(carry_target()).kind).toBe('none')
		expect(run_carry_ended.read_ended(run_carry_ended.ended_path(REPOSITORY))).toMatchObject({
			invocation: INVOCATION,
			stopped: 'stopped by a person with `josh backlogrun --stop`',
		})
	})

	it('pushes no confirmation to the person who typed the stop', async () => {
		await backlogrun_stop.stop(REPOSITORY)

		expect(telegram_notify.confirm).not.toHaveBeenCalled()
	})
})
