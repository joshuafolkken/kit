import { describe, expect, it } from 'vitest'
import { command_usage } from './command-usage'
import { COMMAND_MAP } from './josh-command-map'

const GATE_USAGE = [
	'```bash',
	'pnpm josh gate',
	"pnpm josh gate --verbose      # every check's output, passing ones included",
	'pnpm josh gate --force        # re-run even on a tree already recorded green',
	'pnpm josh gate --no-unit      # the static checks only (CI only)',
	"pnpm josh gate --whole-tree   # add the whole-tree checks (the ship's gate on the final tree)",
	'```',
].join('\n')
const UNKNOWN_NAME = 'not-a-command'
const FILE_FLAG_SUFFIX = '-file'
const STDIN = '-'
const JOSH_TMP = '.josh/tmp/'

// The value after each `--<name>-file` token of one example's arguments.
function file_flag_values(arguments_text: string): Array<string> {
	const tokens = arguments_text.split(' ')

	return tokens
		.map((token, index) =>
			token.endsWith(FILE_FLAG_SUFFIX) ? (tokens[index + 1] ?? '') : undefined,
		)
		.filter((value) => value !== undefined)
}

describe('command usage', () => {
	it('aligns every example comment in one column', () => {
		expect(command_usage.format_usage('gate')).toBe(GATE_USAGE)
	})

	it('lists each flag with its spellings side by side', () => {
		expect(command_usage.format_usage('git')).toContain(
			'**Options:**\n\n- `-y` / `--yes` — run non-interactively',
		)
	})

	it('renders a command from the backlog reference page', () => {
		expect(command_usage.format_usage('epic')).toContain(
			'pnpm josh epic --add 893 894 --before 891',
		)
	})

	it('renders a command from the automation reference page', () => {
		expect(command_usage.format_usage('followup')).toContain(
			'pnpm josh followup "PR title #N" --no-merge',
		)
	})

	it('renders a command from the run reference page', () => {
		expect(command_usage.format_usage('run:release')).toContain(
			'pnpm josh run:release --force   # clear a record left by a run that has ended',
		)
	})

	it('registers a usage for every command in the map', () => {
		const uncovered = Object.keys(COMMAND_MAP).filter(
			(name) => command_usage.format_usage(name) === undefined,
		)

		expect(uncovered).toEqual([])
	})

	it('answers undefined for a name that is not a command', () => {
		expect(command_usage.format_usage(UNKNOWN_NAME)).toBeUndefined()
	})
})

describe('command entry usage', () => {
	it('gives every command at least one example for its usage block', () => {
		const empty = Object.entries(COMMAND_MAP)
			.filter(([, entry]) => entry.usage.examples.length === 0)
			.map(([name]) => name)

		expect(empty).toEqual([])
	})

	it('writes every example body file under .josh/tmp/', () => {
		const misplaced = Object.values(COMMAND_MAP)
			.flatMap((entry) => entry.usage.examples)
			.flatMap((example) => file_flag_values(example.arguments))
			.filter((path) => path !== STDIN && !path.startsWith(JOSH_TMP))

		expect(misplaced).toEqual([])
	})
})

describe('scoped lint command help', () => {
	it('describes scoped lint fixes and remaining errors while preserving its command contract', () => {
		const command = 'lint:related'
		const entry = COMMAND_MAP[command]
		const description =
			'Apply eslint fixes and prettier to the resolved scope, then check remaining errors and in kit the source guard tests (whole tree on fallback)'

		expect(entry?.description).toBe(description)
		expect(entry?.script).toBe('scripts/lint/lint-related.ts')
		expect(entry?.reference[0]).toBe('[files...]')
		expect(command_usage.format_command_help(command)).toContain(description)
		expect(command_usage.format_usage(command)).toBe(
			[
				'```bash',
				'pnpm josh lint:related',
				'pnpm josh lint:related scripts/thing.ts   # narrow by the given files instead',
				'```',
			].join('\n'),
		)
	})
})

describe('command help', () => {
	it('includes all solo evidence in the triage synopsis and example (ac-71557ea7)', () => {
		const help = command_usage.format_command_help('backlog:triage') ?? ''

		expect(help.split('\n', 1)[0]).toContain(
			'[--lane | --solo --defect yes --verification yes --every-run yes]',
		)
		expect(help).toContain(
			'pnpm josh backlog:triage --apply 913 --solo --defect yes --verification yes --every-run yes --reason "<why>" --clear',
		)
	})

	it('resolves an alias and prints the synopsis, description and usage', () => {
		const help = command_usage.format_command_help('ga') ?? ''
		const { gate } = COMMAND_MAP

		expect(help.startsWith(`josh gate ${gate?.reference[0] ?? ''}`)).toBe(true)
		expect(help).toContain(gate?.description)
		expect(help.endsWith(GATE_USAGE)).toBe(true)
	})

	it('answers undefined for an unknown name', () => {
		expect(command_usage.format_command_help(UNKNOWN_NAME)).toBeUndefined()
	})
})
