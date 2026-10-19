import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cases } from '#scripts/cases/cases-logic'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { report_labels } from './report-labels'
import { report_lint } from './report-lint'
import { report_template_cli } from './report-template-cli'

// joshuafolkken/kit#4157: the command prints the skeleton in the session language, and what it prints
// for a non-Japanese session passes `report:lint` in that same session.

const ENV_KEY = 'JOSH_SESSION_LANG'
const directory = mkdtempSync(path.join(tmpdir(), 'report-template-cli-'))
const NETWORK_PATH = path.join(directory, 'net.ts')
const INERT_PATH = path.join(directory, 'pure.ts')

writeFileSync(NETWORK_PATH, 'await fetch(url)\n', 'utf8')
writeFileSync(INERT_PATH, 'export const x = 1\n', 'utf8')

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

function capture(argv: ReadonlyArray<string>): { code: number; out: string; err: string } {
	const out: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		out.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		error.push(String(line))
	})
	const code = report_template_cli.run(argv)

	return { code, out: out.join('\n'), err: error.join('\n') }
}

describe('report_template_cli.run', () => {
	it('prints an English summary that passes report:lint in an English session', () => {
		vi.stubEnv(ENV_KEY, 'en')
		const { code, out } = capture(['summary', 'scripts/report/report-template.ts'])

		expect(code).toBe(0)
		expect(out).toContain(report_labels.ENGLISH_LABELS.overview)
		expect(report_lint.lint_report(out)).toEqual([])
	})

	it('prints the Japanese completion report by default', () => {
		vi.stubEnv(ENV_KEY, undefined)

		expect(capture(['done']).out).toContain(report_labels.JAPANESE_LABELS.completion)
	})

	it('fills the owed abnormal cases for a path that crosses a boundary', () => {
		vi.stubEnv(ENV_KEY, 'ja')
		const owed = cases.cases_for(['network'])

		expect(capture(['summary', NETWORK_PATH]).out).toContain(`1. ${owed[0] ?? ''}`)
	})

	it('fills the owed abnormal cases in English for an English session', () => {
		vi.stubEnv(ENV_KEY, 'en')
		const owed = cases.cases_for(['network'], 'en')

		expect(capture(['summary', NETWORK_PATH]).out).toContain(`1. ${owed[0] ?? ''}`)
	})

	it('pads a path that crosses no boundary with placeholders', () => {
		vi.stubEnv(ENV_KEY, 'ja')

		expect(capture(['summary', INERT_PATH]).out).toContain('1. <…>')
	})

	it.each([[[]], [['handoff']]])('refuses %j with the usage line', (argv) => {
		const { code, err } = capture(argv)

		expect(code).toBe(1)
		expect(err).toContain('Usage: josh report:template summary|done')
	})
})
