import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { measure_rerun_cli } from './measure-rerun-cli'

vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, writer_path: vi.fn() } }
})

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'measure-rerun-'))
const NOW = new Date('2026-09-23T00:00:00Z')
const BODY = ['## ベースライン', '', '- `echo hi` → hi', ''].join('\n')

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

// joshuafolkken/kit#2919: a refuted premise lands in the running tree's file for the checked-out issue,
// which the run's own commit carries.
describe('measure_rerun_cli.run — ledger location', () => {
	it('appends a refuted premise to the file the writer resolves for this tree', async () => {
		const body_path = path.join(TEST_DIR, 'body.md')
		const ledger_path = path.join(TEST_DIR, 'observations.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		writeFileSync(body_path, BODY, 'utf8')
		vi.mocked(observation_ledger_home.writer_path).mockResolvedValue(ledger_path)
		const code = await measure_rerun_cli.run(body_path, NOW)

		info.mockRestore()
		expect(code).toBe(0)
		expect(readFileSync(ledger_path, 'utf8')).toContain('echo hi')
		expect(observation_ledger_home.writer_path).toHaveBeenCalledWith(NOW)
	})
})
