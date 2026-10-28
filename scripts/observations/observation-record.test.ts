import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { followup_failed_tests } from '#scripts/followup/followup-failed-tests'
import { git_spawn } from '#scripts/git/git-spawn'
import prettier from 'prettier'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import {
	FILE_VERDICT,
	LEDGER_VERDICT,
	observation_record,
	REFUSED_VERDICT,
	type ObservationEntry,
} from './observation-record'

// joshuafolkken/kit#3400: the count, the append and the second-sighting verdict are one command. The
// scratch checkouts stand outside any branch, so every line lands in the date-named file. The branch
// lookup is stubbed: inside a git hook `GIT_DIR` points at the enclosing repository, and a real
// `rev-parse` there answers its lane branch instead of failing.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mocked(git_spawn.read).mockRejectedValue(new Error('not a git repository'))

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-record-test-'))
const FIRST_DAY = new Date('2026-10-01T09:00:00Z')
const SECOND_DAY = new Date('2026-10-02T09:00:00Z')
const THIRD_DAY = new Date('2026-10-03T09:00:00Z')
const FIRST_DATE = '2026-10-01'
const SECOND_DATE = '2026-10-02'
const ENTRY: ObservationEntry = {
	slug: 'probe-misses-ship',
	depth: 'd1',
	where: 'pnpm josh run:liveness',
	what: 'The probe answered none while the ship ran',
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function fresh_checkout(name: string): string {
	return path.join(scratch, name)
}

function ledger_file(checkout: string, date: string): string {
	return path.join(checkout, OBSERVATION_LEDGER_DIRECTORY, `${date}.md`)
}

function line_on(date: string): string {
	return `- k:${ENTRY.slug} | d1 | ${date} | ${ENTRY.where} | ${ENTRY.what}`
}

async function verdict_on(checkout: string, now: Date, entry = ENTRY): Promise<string> {
	const result = await observation_record.record({ entry, checkout, now })

	return result.verdict
}

describe('observation_record.record — the verdict', () => {
	it('answers ledger on a first sighting, file on the second and ledger after it', async () => {
		const checkout = fresh_checkout('promotion')

		expect(await verdict_on(checkout, FIRST_DAY)).toBe(LEDGER_VERDICT)
		expect(await verdict_on(checkout, SECOND_DAY)).toBe(FILE_VERDICT)
		expect(await verdict_on(checkout, THIRD_DAY)).toBe(LEDGER_VERDICT)
	})

	it('counts a key exactly, never a longer key it prefixes', async () => {
		const checkout = fresh_checkout('exact')

		await verdict_on(checkout, FIRST_DAY, { ...ENTRY, slug: `${ENTRY.slug}-again` })

		expect(await verdict_on(checkout, SECOND_DAY)).toBe(LEDGER_VERDICT)
	})
})

describe('observation_record.record — the line', () => {
	it('appends the line in the ledger grammar and hands back the earlier sightings', async () => {
		const checkout = fresh_checkout('append')
		const target = ledger_file(checkout, SECOND_DATE)

		await verdict_on(checkout, FIRST_DAY)

		expect(
			await observation_record.record({ entry: ENTRY, checkout, now: SECOND_DAY }),
		).toStrictEqual({
			verdict: FILE_VERDICT,
			earlier: [line_on(FIRST_DATE)],
			line: line_on(SECOND_DATE),
			target,
		})
		expect(readFileSync(target, 'utf8')).toBe(`${line_on(SECOND_DATE)}\n`)
	})

	it.each([
		[{ ...ENTRY, slug: 'example' }, 'reserved'],
		[{ ...ENTRY, slug: 'Not A Slug' }, 'slug'],
		[{ ...ENTRY, depth: 'd0' }, 'depth'],
		[{ ...ENTRY, what: 'a | b' }, 'fields'],
	])('refuses %j and appends nothing', async (entry, reason) => {
		const checkout = fresh_checkout(`refused-${reason}`)
		const result = await observation_record.record({ entry, checkout, now: FIRST_DAY })

		expect(result.verdict).toBe(REFUSED_VERDICT)
		expect(result.verdict === REFUSED_VERDICT ? result.reason : '').toContain(reason)
		expect(existsSync(ledger_file(checkout, FIRST_DATE))).toBe(false)
	})
})

// joshuafolkken/kit#5197: `followup` keeps its line on the issue, so it reads the verdict alone.
describe('observation_record.assess', () => {
	it('answers the verdict and the earlier sightings, appending nothing', async () => {
		const checkout = fresh_checkout('assess')

		await verdict_on(checkout, FIRST_DAY)

		expect(
			await observation_record.assess({ entry: ENTRY, checkout, now: SECOND_DAY }),
		).toStrictEqual({
			verdict: FILE_VERDICT,
			earlier: [line_on(FIRST_DATE)],
			line: line_on(SECOND_DATE),
		})
		expect(existsSync(ledger_file(checkout, SECOND_DATE))).toBe(false)
	})
})

// joshuafolkken/kit#5303: vitest pads a workspace test name, and a ledger file holding the padding
// failed a later lane's Prettier check.
async function line_or_reason(entry: ObservationEntry, name: string): Promise<string> {
	const result = await observation_record.assess({
		entry,
		checkout: fresh_checkout(name),
		now: FIRST_DAY,
	})

	return result.verdict === REFUSED_VERDICT ? result.reason : result.line
}

describe('observation_record.assess — a padded vitest name', () => {
	const PADDED_LOG = ' FAIL  |isolated|  scripts/test/test-related.claim.test.ts > claim > holds'

	async function padded_line(): Promise<string> {
		const tests = followup_failed_tests.read_failed_tests(PADDED_LOG)

		return await line_or_reason(
			followup_failed_tests.observation_of([{ job: 'Unit Tests (5/6)', tests }]),
			'padded',
		)
	}

	it('collapses every whitespace run in the line to one space', async () => {
		const line = await padded_line()

		expect(line).toContain('/isolated/ scripts/test/test-related.claim.test.ts > claim > holds')
		expect(line).not.toMatch(/\s{2}/u)
	})

	it('writes a line Prettier leaves unchanged as markdown', async () => {
		const ledger = `${await padded_line()}\n`
		const options = await prettier.resolveConfig(ledger_file(scratch, FIRST_DATE))

		expect(await prettier.format(ledger, { ...options, parser: 'markdown' })).toBe(ledger)
	})
})

describe('observation_record.assess — whitespace in a field', () => {
	it('collapses a tab, a newline and the edge spaces of each field', async () => {
		expect(await line_or_reason({ ...ENTRY, where: ' a\tb ', what: 'c\n  d ' }, 'edges')).toBe(
			`- k:${ENTRY.slug} | d1 | ${FIRST_DATE} | a b | c d`,
		)
	})

	it('refuses a field whose collapsed whitespace around a pipe reads as a separator', async () => {
		expect(await line_or_reason({ ...ENTRY, what: 'c\t|  d' }, 'pipe')).toContain('fields')
	})
})
