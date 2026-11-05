import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_auto_triage } from './backlog-auto-triage'
import type { PoolContext } from './backlog-gate-scope'
import { backlog_next } from './backlog-next'
import { backlog_triage_pass } from './backlog-triage-pass'

vi.mock('./backlog-next', () => ({ backlog_next: { context_of: vi.fn(), resolve: vi.fn() } }))
vi.mock('./backlog-auto-triage', () => ({ backlog_auto_triage: { untriaged_of: vi.fn() } }))

const REPO = 'owner/repo'
const PARKED = 901
const UNTRIAGED = 902
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

vi.spyOn(console, 'error').mockImplementation(() => undefined)
const classify = vi.mocked(backlog_next.resolve)
const read_context = vi.mocked(backlog_next.context_of)
const settle = vi.mocked(backlog_auto_triage.untriaged_of)
const fetch_pool = vi.spyOn(auto_ok_cli, 'fetch_opted_in')

function child(number: number, labels: ReadonlyArray<string> = []): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: [] }
}

function result(): EpicNextResult {
	return { verdict: 'run', candidates: [], waiting: [], blocked_on_people: [], anomalies: [] }
}

function context(): PoolContext {
	return {
		opted_in: { kind: 'read', issues: [], cutoff: 'none' },
		tracking: { kind: 'read', index: new Map(), cutoff: 'none' },
		repo: REPO,
		exclude: [],
		implement_rate: undefined,
	}
}

beforeEach(() => {
	fetch_pool.mockResolvedValue({ kind: 'read', issues: [], cutoff: 'none' })
	read_context.mockResolvedValue(context())
	classify.mockResolvedValue(result())
	settle.mockResolvedValue({ result: result(), untriaged: [] })
})

describe('the parent triage pass', () => {
	it('settles mechanical candidates and prints only the next waves command when done', async () => {
		expect(await backlog_triage_pass.run([])).toBe(0)
		expect(settle).toHaveBeenCalledWith(result(), REPO)
		expect(info).toHaveBeenCalledExactlyOnceWith('pnpm josh backlog:plan --waves')
	})

	it('batches local decisions and remaining judgments into one body-and-comments read', async () => {
		const snapshot = result()

		snapshot.blocked_on_people = [child(PARKED, [NEEDS_DECISION_LABEL]), child(UNTRIAGED)]
		classify.mockResolvedValue(snapshot)
		settle.mockResolvedValue({ result: snapshot, untriaged: [child(UNTRIAGED)] })
		await backlog_triage_pass.run([])

		expect(info).toHaveBeenCalledExactlyOnceWith(
			`pnpm josh issue:read ${String(PARKED)} ${String(UNTRIAGED)}`,
		)
	})

	it('passes excluded decisions to the shared pool classifier', async () => {
		await backlog_triage_pass.run(['--exclude', String(PARKED)])

		expect(read_context).toHaveBeenCalledWith(expect.objectContaining({ kind: 'read' }), [PARKED])
	})
})

describe('triage pass refusals', () => {
	it('refuses invalid flags before reading', async () => {
		expect(await backlog_triage_pass.run(['--force'])).toBe(1)
		expect(fetch_pool).not.toHaveBeenCalled()
	})

	it('refuses a failed pool read without printing a next command', async () => {
		fetch_pool.mockResolvedValue({ kind: 'unreadable' })

		expect(await backlog_triage_pass.run([])).toBe(1)
		expect(classify).not.toHaveBeenCalled()
		expect(info).not.toHaveBeenCalled()
	})

	it.each([undefined, { ...result(), verdict: 'error' } as const])(
		'refuses failed classification or graph anomalies',
		async (snapshot) => {
			classify.mockResolvedValue(snapshot)

			expect(await backlog_triage_pass.run([])).toBe(1)
			expect(settle).not.toHaveBeenCalled()
			expect(info).not.toHaveBeenCalled()
		},
	)
})

describe('triage pass listing boundaries', () => {
	it.each(['opted_in', 'tracking'] as const)('refuses a truncated %s listing', async (field) => {
		const snapshot = context()

		snapshot[field].cutoff = 'row_limit'
		read_context.mockResolvedValue(snapshot)

		expect(await backlog_triage_pass.run([])).toBe(1)
		expect(classify).not.toHaveBeenCalled()
		expect(info).not.toHaveBeenCalled()
	})

	it('refuses an unreadable context', async () => {
		read_context.mockResolvedValue(undefined)

		expect(await backlog_triage_pass.run([])).toBe(1)
		expect(classify).not.toHaveBeenCalled()
	})
})
