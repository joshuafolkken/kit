import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cases } from '#scripts/cases/cases-logic'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { report_labels } from './report-labels'
import { report_lint } from './report-lint'
import { report_template_cli } from './report-template-cli'

// joshuafolkken/kit#4157: the command prints the skeleton in the session language, and what it prints
// for a non-Japanese session passes `report:lint` in that same session. joshuafolkken/kit#4491: the
// shared-state and environment conditions lead "if it breaks", ahead of the I/O cases.

const ENV_KEY = 'JOSH_SESSION_LANG'
const directory = mkdtempSync(path.join(tmpdir(), 'report-template-cli-'))
const NETWORK_PATH = path.join(directory, 'net.ts')
const ENVIRONMENT_PATH = path.join(directory, 'env.ts')
const INERT_PATH = path.join(directory, 'pure.ts')

writeFileSync(NETWORK_PATH, 'await fetch(url)\n', 'utf8')
writeFileSync(ENVIRONMENT_PATH, "await fetch(process.env['API_URL'])\n", 'utf8')
writeFileSync(INERT_PATH, 'export const x = 1\n', 'utf8')

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

async function capture(
	argv: ReadonlyArray<string>,
): Promise<{ code: number; out: string; err: string }> {
	const out: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		out.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		error.push(String(line))
	})
	const code = await report_template_cli.run(argv)

	return { code, out: out.join('\n'), err: error.join('\n') }
}

describe('report_template_cli.run', () => {
	it('prints an English summary that passes report:lint in an English session', async () => {
		vi.stubEnv(ENV_KEY, 'en')
		const { code, out } = await capture(['summary', 'scripts/report/report-template.ts'])

		expect(code).toBe(0)
		expect(out).toContain(report_labels.ENGLISH_LABELS.overview)
		expect(report_lint.lint_report(out)).toEqual([])
	})

	it('prints the Japanese completion report by default', async () => {
		vi.stubEnv(ENV_KEY, undefined)
		const { out } = await capture(['done'])

		expect(out).toContain(report_labels.JAPANESE_LABELS.completion)
	})

	it.each([[[]], [['handoff']]])('refuses %j with the usage line', async (argv) => {
		const { code, err } = await capture(argv)

		expect(code).toBe(1)
		expect(err).toContain('Usage: josh report:template summary|done')
	})
})

describe('report_template_cli.run — if it breaks', () => {
	it.each(['ja', 'en'])('fills the owed abnormal cases in a %s session', async (lang) => {
		vi.stubEnv(ENV_KEY, lang)
		const owed = cases.cases_for(['network'], lang)
		const { out } = await capture(['summary', NETWORK_PATH])

		expect(out).toContain(`1. ${owed[0] ?? ''}`)
	})

	it('puts the environment condition ahead of the I/O cases', async () => {
		vi.stubEnv(ENV_KEY, 'ja')
		const owed = cases.cases_for(['network'])
		const { out } = await capture(['summary', ENVIRONMENT_PATH])

		expect(out).toContain('1. 環境変数 `API_URL`: 未設定')
		expect(out).toContain(`2. ${owed[0] ?? ''}`)
	})

	it('pads a path that crosses no boundary with placeholders', async () => {
		vi.stubEnv(ENV_KEY, 'ja')
		const { out } = await capture(['summary', INERT_PATH])

		expect(out).toContain('1. <…>')
	})
})
