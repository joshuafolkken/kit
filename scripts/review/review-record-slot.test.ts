import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stamp files live in memory, so the test never writes the findings file or the attest records a
// real run in this checkout reads.
const stamps = vi.hoisted(() => new Map<string, string>())

vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: (source: string) => stamps.get(source),
		remove_stamp: (target: string) => stamps.delete(target),
		stamp_path: (prefix: string, root: string, suffix = '') => `${root}/${prefix}${suffix}`,
		write_stamp: (target: string, value: unknown) => stamps.set(target, JSON.stringify(value)),
		write_text_stamp: (target: string, text: string) => stamps.set(target, text),
	},
}))

const { PROJECT_ROOT } = await import('#scripts/init/init-paths')
const { lane_session_broker } = await import('#scripts/lane/lane-session-broker')
const { review_attest } = await import('./review-attest')
const { review_record_cli } = await import('./review-record-cli')
const { review_record_slot } = await import('./review-record-slot')
const { review_submit_cli } = await import('./review-submit-cli')

// joshuafolkken/kit#5549: the reviewer `run:review` briefs writes its findings with `review:submit`,
// and the parent records them with `review:record --from-slot` rather than copying them by hand.

const MEDIUM = 'bug-risks:medium:a.ts:3 — the count never trips'
const LOW = 'tests:low:a.test.ts — the edge case is untested'
const FINDINGS = `${MEDIUM}\n${LOW}\n`
const ISSUE = '5549'
const FROM_SLOT = ['--from-slot', '--issue', ISSUE]
const INTERACTION = '--interaction'
const LEDGER_DATE = '2026-10-31'
const CHECKOUT = { root: PROJECT_ROOT, branch: '5549-lane', head: 'a'.repeat(40) }

beforeEach(() => {
	stamps.clear()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

function ledger_lines(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	const findings = argv
		.filter((argument) => argument.includes(':'))
		.map((positional) => review_record_cli.parse_positional(positional)?.finding)
		.filter((finding) => finding !== undefined)

	return review_record_cli.build_lines({ issue: Number(ISSUE), findings }, LEDGER_DATE)
}

describe('review_record_slot — the brief-keyed slot review:submit writes', () => {
	it.each([
		['code', [], 'code'],
		['interaction', [INTERACTION], 'interaction'],
	] as const)('writes the %s findings where run:review briefed them', (_name, flags, slot) => {
		expect(review_submit_cli.run(flags, FINDINGS)).toBe(0)

		const { brief, findings } = lane_session_broker.review_paths(PROJECT_ROOT, slot)

		expect(brief).toContain(PROJECT_ROOT)
		expect(stamps.get(findings)).toBe(FINDINGS)
	})
})

describe('review_record_slot — review:record reads the slot', () => {
	it('records every finding fixed when no disposition is given', () => {
		review_submit_cli.run([], FINDINGS)

		const { argv } = review_record_slot.expand(FROM_SLOT)

		expect(argv).toStrictEqual(['--issue', ISSUE, `fixed ${MEDIUM}`, `fixed ${LOW}`])
		expect(ledger_lines(argv).every((line) => line.includes('fixed'))).toBe(true)
	})

	it('records a finding with the disposition its line number is given', () => {
		review_submit_cli.run([], FINDINGS)

		const { argv } = review_record_slot.expand([...FROM_SLOT, '2=filed:#6000'])

		expect(argv.slice(2)).toStrictEqual([`fixed ${MEDIUM}`, `filed:#6000 ${LOW}`])
		expect(ledger_lines(argv)[1]).toContain('filed:#6000')
	})

	it('drops the reviewer’s own fixed mark rather than doubling it', () => {
		review_submit_cli.run([], `fixed ${MEDIUM}\n`)

		expect(review_record_slot.expand(FROM_SLOT).argv.slice(2)).toStrictEqual([`fixed ${MEDIUM}`])
	})

	it('reads the interaction slot under --interaction and keeps the flag', () => {
		review_submit_cli.run([INTERACTION], `${LOW}\n`)

		expect(review_record_slot.expand([...FROM_SLOT, INTERACTION]).argv).toStrictEqual([
			'--issue',
			ISSUE,
			INTERACTION,
			`fixed ${LOW}`,
		])
	})

	it('records a --none review as a zero-finding round', () => {
		review_submit_cli.run(['--none'], '')

		expect(review_record_slot.expand(FROM_SLOT).argv).toStrictEqual(['--issue', ISSUE])
	})

	it('passes an argv without --from-slot through untouched', () => {
		const argv = ['--issue', ISSUE, MEDIUM]

		expect(review_record_slot.expand(argv)).toStrictEqual({ argv })
	})
})

describe('review_record_slot — refusals', () => {
	it('refuses a slot the reviewer never wrote', () => {
		expect(review_record_slot.expand(FROM_SLOT).refusal).toContain('no findings file')
	})

	it.each([['0=fixed'], ['x=fixed'], ['1='], ['fixed']])('refuses the override %s', (override) => {
		review_submit_cli.run([], FINDINGS)

		expect(review_record_slot.expand([...FROM_SLOT, override]).refusal).toContain(override)
	})

	it('refuses an override past the last finding', () => {
		review_submit_cli.run([], FINDINGS)

		expect(review_record_slot.expand([...FROM_SLOT, '3=fixed']).refusal).toContain('no finding 3')
	})
})

describe('review_record_slot.run — the review:record entry', () => {
	type Recorder = (argv: ReadonlyArray<string>, now: Date) => Promise<number>
	it('exits 1 on a refused expansion and records nothing', async () => {
		const record = vi.fn<Recorder>()

		expect(await review_record_slot.run(FROM_SLOT, record)).toBe(1)
		expect(record).not.toHaveBeenCalled()
	})

	it('hands review:record the expanded argv', async () => {
		const record = vi.fn<Recorder>().mockResolvedValue(0)

		review_submit_cli.run([], `${LOW}\n`)

		expect(await review_record_slot.run(FROM_SLOT, record)).toBe(0)
		expect(record).toHaveBeenCalledWith(['--issue', ISSUE, `fixed ${LOW}`], expect.any(Date))
	})
})

describe('review_record_slot — review:attest --check', () => {
	it('answers ok for a review whose findings went through the slot', () => {
		const nonce = review_attest.record_target(CHECKOUT, PROJECT_ROOT)

		review_attest.attest(nonce, CHECKOUT)
		review_submit_cli.run([], FINDINGS)

		expect(review_attest.check(Date.now(), PROJECT_ROOT).status).toBe('ok')
		expect(review_record_slot.expand(FROM_SLOT).refusal).toBeUndefined()
	})
})
