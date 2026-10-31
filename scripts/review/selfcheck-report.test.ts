import { describe, expect, it } from 'vitest'
import { selfcheck_report, type Sections } from './selfcheck-report'

const CLEAN: Sections = {
	stale: { text: 'ok', exit_code: 0 },
	readers: { readers: [], omitted: 0, has_failed: false },
	commands: { lines: [], failed: 0 },
}
const READER = {
	target: 'run',
	origin: 'scripts/a.ts:3',
	hits: [{ path: 'scripts/b.ts', line: '9', excerpt: 'run()' }],
	has_failed: false,
}

function verdict(sections: Sections): string {
	return selfcheck_report.report(sections).text.split('\n').at(-1) ?? ''
}

describe('selfcheck_report.report', () => {
	it('passes a clean diff with every block answered none', () => {
		const { text, exit_code } = selfcheck_report.report(CLEAN)

		expect(exit_code).toBe(0)
		expect(text).toContain('## q10 commands run\nnone')
		expect(verdict(CLEAN)).toBe(
			'selfcheck: pass — q2 0 stale · q10 0 failed (q4: 0 readers to read)',
		)
	})

	it('lists a reader outside the diff as file:line without failing the verdict', () => {
		const sections = { ...CLEAN, readers: { ...CLEAN.readers, readers: [READER] } }
		const { text, exit_code } = selfcheck_report.report(sections)

		expect(exit_code).toBe(0)
		expect(text).toContain('scripts/b.ts:9 run (from scripts/a.ts:3)')
		expect(verdict(sections)).toContain('(q4: 1 readers to read)')
	})

	it('fails on a stale mention or a failed command, counting each', () => {
		const sections = {
			...CLEAN,
			stale: { text: 'docs/a.md:3 name old\ndocs/b.md:4 name old', exit_code: 1 },
			commands: { lines: ['fail root: pnpm josh x:y → exit 1 — no'], failed: 1 },
		}

		expect(selfcheck_report.report(sections).exit_code).toBe(1)
		expect(verdict(sections)).toBe(
			'selfcheck: fail — q2 2 stale · q10 1 failed (q4: 0 readers to read)',
		)
	})
})

describe('selfcheck_report.report on a failed search', () => {
	it('answers a search that failed with exit 2, never as none found', () => {
		const failed_reader = { ...READER, hits: [], has_failed: true }
		const sections = {
			...CLEAN,
			readers: { ...CLEAN.readers, readers: [failed_reader], has_failed: true },
		}
		const { text, exit_code } = selfcheck_report.report(sections)

		expect(exit_code).toBe(selfcheck_report.FAILED_EXIT)
		expect(text).toContain('search failed: run')
		expect(verdict(sections)).toMatch(/^selfcheck: unanswered/u)
	})
})
