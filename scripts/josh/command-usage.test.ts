import { describe, expect, it } from 'vitest'
import { command_usage } from './command-usage'
import { COMMAND_MAP } from './josh-command-map'

const GATE_USAGE = [
	'```bash',
	'pnpm josh gate',
	"pnpm josh gate --verbose   # every check's output, passing ones included",
	'pnpm josh gate --force     # re-run even on a tree already recorded green',
	'pnpm josh gate --no-unit   # the static checks only (CI only)',
	'```',
].join('\n')
const UNKNOWN_NAME = 'not-a-command'

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

describe('command help', () => {
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
