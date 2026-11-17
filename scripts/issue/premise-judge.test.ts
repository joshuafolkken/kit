import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measure_declaration } from './measure-declaration'
import { premise_judge } from './premise-judge'
import { trusted_measure } from './trusted-measure'

// joshuafolkken/kit#7729's premise: `lane:stats` prints a table, so its last line is not a number.
const STATS_COMMAND = 'pnpm josh lane:stats --period 3'
const STATS_TABLE = [
	'| measured lanes | files actual / declared median | lines actual / declared median | pre-split misses |',
	'| --- | --- | --- | --- |',
	'| 89 | 1.0 | 1.7 | 3 |',
].join('\n')
const NUMBER_COMMAND =
	'pnpm josh lane:value cell --table "measured lanes" --column "measured lanes"'
const MEASURE_COMMAND = 'pnpm josh lane:net 7769'

function body_of(...lines: ReadonlyArray<string>): string {
	return `## 背景\n\n${lines.join('\n')}\n`
}

function output_of(command: string): string {
	return command === STATS_COMMAND ? STATS_TABLE : '89'
}

beforeEach(() => {
	vi.spyOn(trusted_measure, 'run_command').mockImplementation((command) => ({
		kind: 'ok',
		output: output_of(command),
	}))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('premise_judge.draft_problems', () => {
	it('refuses #7729 premise, naming its last line and lane:value cell (ac-6cec9c55, ac-411ac3e4)', () => {
		const [problem, ...rest] = premise_judge.draft_problems(
			body_of(`- 前提: \`${STATS_COMMAND}\` >= 3`),
		)

		expect(rest).toStrictEqual([])
		expect(problem).toContain('is unreadable')
		expect(problem).toContain('`| 89 | 1.0 | 1.7 | 3 |`')
		expect(problem).toContain('pnpm josh lane:value cell --table <表> --column <列>')
	})

	it('passes a premise whose last line is a number, held or not (ac-344f85d7)', () => {
		const body = body_of(`- 前提: \`${NUMBER_COMMAND}\` >= 3`, `- 前提: \`${NUMBER_COMMAND}\` < 3`)

		expect(premise_judge.draft_problems(body)).toStrictEqual([])
	})

	it('passes a premise whose command fails: the lane entry stops on it', () => {
		vi.mocked(trusted_measure.run_command).mockReturnValue({ kind: 'failed', message: 'boom' })

		expect(
			premise_judge.draft_problems(body_of(`- 前提: \`${STATS_COMMAND}\` >= 3`)),
		).toStrictEqual([])
	})

	it('never runs the measurement declaration (ac-33b1ae23)', () => {
		const body = body_of(`- 計測宣言: \`${MEASURE_COMMAND}\` <= 40`)

		expect(premise_judge.draft_problems(body)).toStrictEqual([])
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7769: a draft built from an untrusted body never runs that body's premises.
describe('premise_judge — inherited premises', () => {
	const premised = body_of(`- 前提: \`${STATS_COMMAND}\` >= 3`)

	it('skips a premise the inherited untrusted body declares', () => {
		expect(premise_judge.draft_problems(premised, premised)).toStrictEqual([])
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
	})

	it('drops the premise lines of an untrusted issue it carries', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(trusted_measure, 'read_trusted_body').mockResolvedValue({
			kind: 'refused',
			reason: 'untrusted author',
		})

		expect(await premise_judge.carried('1', premised)).toBe('## 背景\n\n')
	})

	it('carries a trusted issue body as is', async () => {
		vi.spyOn(trusted_measure, 'read_trusted_body').mockResolvedValue(
			trusted_measure.drafted(premised),
		)

		expect(await premise_judge.carried('1', premised)).toBe(premised)
	})
})

describe('premise_judge.run_of', () => {
	it('reads the output with the same judge the lane entry uses (ac-e98b16f9)', () => {
		const [declaration] = measure_declaration.premises(body_of(`- 前提: \`${STATS_COMMAND}\` >= 3`))

		if (declaration === undefined) throw new Error('premise not parsed')
		const source = trusted_measure.drafted('')

		expect(premise_judge.run_of(declaration, source)).toStrictEqual({
			kind: 'judged',
			declaration,
			output: STATS_TABLE,
			verdict: { kind: 'unreadable' },
		})
		expect(trusted_measure.run_command).toHaveBeenCalledWith(STATS_COMMAND, source)
	})
})
