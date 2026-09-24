import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2492: a `backlogrun` now flushes its ledger once, at `run:carry --end`, after the
// retrospective has run — so the retrospective must count the lines still waiting in the primary
// checkout's file, never only what main already holds. This pins that it reads the file on disk.

const scratch = mkdtempSync(path.join(tmpdir(), 'retrospective-cli-test-'))
const LEDGER = path.join(scratch, 'observations.md')
const UNFLUSHED =
	'- k:lane-ledger-line-unflushed | d1 | 2026-09-24 | pnpm josh run:tail | A lane appended this line and never flushed it'

vi.mock('#scripts/observations/observation-ledger-home', () => ({
	observation_ledger_home: { ledger_path: vi.fn(() => LEDGER) },
}))
vi.mock('#scripts/run/run-carry', () => ({
	run_carry: { repository_directory: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/cost/cost-run-tree', () => ({ cost_run_tree: { load: vi.fn(() => undefined) } }))

const { retrospective_cli } = await import('./retrospective-cli')

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('retrospective_cli.gather — the ledger is read from the file on disk', () => {
	it('counts a line appended in the primary checkout and not yet flushed to main', async () => {
		writeFileSync(LEDGER, `# Observations\n\n${UNFLUSHED}\n`)

		const inputs = await retrospective_cli.gather(scratch)

		expect(inputs.observations).toStrictEqual([UNFLUSHED])
	})

	it('reads an absent ledger as no observations rather than failing', async () => {
		rmSync(LEDGER, { force: true })

		const inputs = await retrospective_cli.gather(scratch)

		expect(inputs.observations).toStrictEqual([])
	})
})
