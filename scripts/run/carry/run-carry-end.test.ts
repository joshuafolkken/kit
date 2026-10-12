import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_end } from './run-carry-end'
import { run_carry_ended } from './run-carry-ended'

// joshuafolkken/kit#3708: the run's end, shared by `run:carry --end` and `josh backlogrun --stop` — and
// the one difference between them, whether a stop is announced.

vi.mock('./run-carry-stash', () => ({
	run_carry_stash: { report_orphans: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { confirm: vi.fn().mockResolvedValue(true) },
}))
vi.mock('#scripts/run/merge/run-merge-collect', () => ({
	run_merge_collect: { collect_merged: vi.fn().mockResolvedValue(undefined) },
}))

const { telegram_notify } = await import('#scripts/notify/telegram-notify')
const confirm = vi.mocked(telegram_notify.confirm)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-end-test-'))
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const REASON = 'stopped by a person'
const NOW = new Date('2026-10-12T09:00:00.000Z')

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

function begin(): void {
	stamp_file.write_stamp(carry_target(), run_carry.fresh_carry(INVOCATION, {}, NOW))
}

beforeEach(() => {
	confirm.mockClear()
	run_carry.end_carry(carry_target())
})

afterAll(() => {
	run_carry.end_carry(carry_target())
	rmSync(run_carry_ended.ended_path(REPOSITORY), { force: true })
	rmSync(scratch, { recursive: true, force: true })
})

describe('run_carry_end.end_run', () => {
	it('removes the record, hands back what it held and keeps it as the stopped run', async () => {
		begin()

		const read = await run_carry_end.end_run(REPOSITORY, { stopped: REASON, is_announced: false })

		expect(read).toMatchObject({ kind: 'carried', carry: { invocation: INVOCATION } })
		expect(run_carry.read_carry(carry_target()).kind).toBe('none')
		expect(run_carry_ended.read_ended(run_carry_ended.ended_path(REPOSITORY))).toMatchObject({
			invocation: INVOCATION,
			stopped: REASON,
		})
	})

	it('pushes no confirmation for a stop that is not announced', async () => {
		begin()
		await run_carry_end.end_run(REPOSITORY, { stopped: REASON, is_announced: false })

		expect(confirm).not.toHaveBeenCalled()
	})

	it('pushes one confirmation for an announced stop, and none for the second end', async () => {
		begin()
		await run_carry_end.end_run(REPOSITORY, { stopped: REASON, is_announced: true })
		await run_carry_end.end_run(REPOSITORY, { stopped: REASON, is_announced: true })

		expect(confirm).toHaveBeenCalledOnce()
	})

	it('answers none where there is no record to end', async () => {
		const read = await run_carry_end.end_run(REPOSITORY, { stopped: REASON, is_announced: true })

		expect(read.kind).toBe('none')
		expect(confirm).not.toHaveBeenCalled()
	})
})
