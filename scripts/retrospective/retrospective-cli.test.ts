import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2919: the ledger is a directory of one file per issue, and the retrospective
// counts every file in it from the work tree on disk — a line one lane's pull request has not merged
// yet is still a line the retrospective sees.

const scratch = mkdtempSync(path.join(tmpdir(), 'retrospective-cli-test-'))
const LEDGER = path.join(scratch, observation_ledger.ledger_file(1))
const OTHER_LEDGER = path.join(scratch, observation_ledger.ledger_file(2))
const LINE =
	'- k:lane-ledger-line-unmerged | d1 | 2026-09-24 | pnpm josh run:tail | A lane appended this line before its merge'
const OTHER_LINE =
	'- k:another-lane-line | d1 | 2026-09-24 | pnpm josh run:tail | A second lane appended this one'

vi.mock('#scripts/run/run-carry', () => ({
	run_carry: { repository_directory: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/cost/cost-run-tree', () => ({ cost_run_tree: { load: vi.fn(() => undefined) } }))

const { retrospective_cli } = await import('./retrospective-cli')

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('retrospective_cli.gather — the ledger is read from the files on disk', () => {
	it('counts the lines of every issue file in the directory', async () => {
		mkdirSync(path.dirname(LEDGER), { recursive: true })
		writeFileSync(LEDGER, `${LINE}\n`)
		writeFileSync(OTHER_LEDGER, `${OTHER_LINE}\n`)

		const inputs = await retrospective_cli.gather(scratch)

		expect(inputs.observations).toStrictEqual([LINE, OTHER_LINE])
	})

	it('reads an absent ledger as no observations rather than failing', async () => {
		rmSync(path.dirname(LEDGER), { force: true, recursive: true })

		const inputs = await retrospective_cli.gather(scratch)

		expect(inputs.observations).toStrictEqual([])
	})
})
