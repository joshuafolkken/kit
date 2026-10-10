import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observation_record, type ObservationEntry } from './observation-record'
import { observation_record_cli } from './observation-record-cli'

// joshuafolkken/kit#3400: one verdict token on stdout, the sightings and the file on stderr, and a
// non-zero exit wherever nothing was recorded.

const NOW = new Date('2026-10-09T09:00:00Z')
const ENTRY: ObservationEntry = {
	slug: 'probe-misses-ship',
	depth: 'd1',
	where: 'pnpm josh run:liveness',
	what: 'The probe answered none',
}
const FIELDS = [ENTRY.slug, ENTRY.depth, ENTRY.where, ENTRY.what]
const CHECKOUT = 'other-checkout'
const TARGET = `${CHECKOUT}/.josh/observations/3400.md`
const EARLIER = `- k:${ENTRY.slug} | d1 | 2026-10-01 | ${ENTRY.where} | seen`
const REFUSAL = 'the slug must be lowercase'

const info_lines: Array<string> = []
const error_lines: Array<string> = []

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
})

afterEach(() => {
	info_lines.length = 0
	error_lines.length = 0
	vi.restoreAllMocks()
})

describe('observation_record_cli.run — a recorded sighting', () => {
	it('prints the verdict alone on stdout and the earlier sightings on stderr', async () => {
		const record = vi.spyOn(observation_record, 'record').mockResolvedValue({
			verdict: 'file',
			earlier: [EARLIER],
			line: '',
			target: TARGET,
		})

		const code = await observation_record_cli.run([...FIELDS, '--checkout', CHECKOUT], NOW)

		expect(code).toBe(0)
		expect(info_lines).toStrictEqual(['file'])
		expect(error_lines.join('\n')).toContain(EARLIER)
		expect(error_lines.join('\n')).toContain(TARGET)
		expect(record).toHaveBeenCalledWith({ entry: ENTRY, checkout: CHECKOUT, now: NOW })
	})
})

describe('observation_record_cli.run — nothing recorded', () => {
	it('exits non-zero with the reason when the line is refused', async () => {
		vi.spyOn(observation_record, 'record').mockResolvedValue({
			verdict: 'refused',
			reason: REFUSAL,
		})

		expect(await observation_record_cli.run(FIELDS, NOW)).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines.join('\n')).toContain(REFUSAL)
	})

	it.each([[FIELDS.slice(1)], [[...FIELDS, 'extra']], [[...FIELDS, '--unknown']]])(
		'prints the usage for %j and records nothing',
		async (argv) => {
			const record = vi.spyOn(observation_record, 'record')

			expect(await observation_record_cli.run(argv, NOW)).toBe(1)
			expect(error_lines).toStrictEqual([observation_record_cli.USAGE])
			expect(record).not.toHaveBeenCalled()
		},
	)
})
