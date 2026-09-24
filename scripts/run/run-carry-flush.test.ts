import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2492: the batch's one ledger flush. Git and the flush subprocess are mocked, so the
// decision — flush only a pending append, report a failure and never throw it — is pinned without a
// pull request ever being opened.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: vi.fn() } }))
const PRIMARY = vi.hoisted(() => '/work/kit')

vi.mock('#scripts/observations/observation-ledger-home', () => ({
	observation_ledger_home: { ledger_root: vi.fn(() => PRIMARY) },
}))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { josh_command } = await import('#scripts/josh/josh-run')
const { run_carry_flush } = await import('./run-carry-flush')
const read = vi.mocked(git_spawn.read)
const josh_run = vi.mocked(josh_command.josh_run)

const PENDING = ` M ${OBSERVATION_LEDGER_PATH}`
const OK = 0
const FAILED = 1
const errors: Array<string> = []

beforeEach(() => {
	vi.clearAllMocks()
	errors.length = 0
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
	josh_run.mockResolvedValue({ code: OK, out: 'flushed' })
})

describe('run_carry_flush.flush_ledger — one flush of a pending append', () => {
	it("reads the primary checkout's status, not the lane's", async () => {
		read.mockResolvedValue(PENDING)

		await run_carry_flush.flush_ledger()

		expect(read.mock.calls[0]?.[0].slice(0, 2)).toStrictEqual(['-C', PRIMARY])
	})

	it('flushes once when the ledger holds a pending append — whichever run wrote it', async () => {
		read.mockResolvedValue(PENDING)

		await run_carry_flush.flush_ledger()

		expect(josh_run).toHaveBeenCalledOnce()
		expect(josh_run).toHaveBeenCalledWith(run_carry_flush.FLUSH_ARGV, true)
		expect(errors).toStrictEqual(['flushed'])
	})

	it('does nothing when the ledger has no pending append', async () => {
		read.mockResolvedValue(' M scripts/run/run-carry.ts')

		await run_carry_flush.flush_ledger()

		expect(josh_run).not.toHaveBeenCalled()
		expect(errors).toStrictEqual([])
	})
})

describe('run_carry_flush.flush_ledger — a failure is reported, never thrown', () => {
	it('names the recovery when the flush exits non-zero', async () => {
		read.mockResolvedValue(PENDING)
		josh_run.mockResolvedValue({ code: FAILED, out: '' })

		await expect(run_carry_flush.flush_ledger()).resolves.toBeUndefined()
		expect(errors).toStrictEqual([run_carry_flush.FAILURE_NOTE])
	})

	it('names the recovery when git status cannot be read', async () => {
		read.mockRejectedValue(new Error('not a git repository'))

		await expect(run_carry_flush.flush_ledger()).resolves.toBeUndefined()
		expect(errors).toStrictEqual([run_carry_flush.FAILURE_NOTE])
	})
})
