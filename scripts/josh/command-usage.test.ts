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
// A registered command the usage table does not cover yet.
const UNCOVERED_COMMAND = 'followup'

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

	it('renders a command from the run reference page', () => {
		expect(command_usage.format_usage('run:release')).toContain(
			'pnpm josh run:release --force   # clear a record left by a run that has ended',
		)
	})

	it('answers undefined for a command with no usage', () => {
		expect(command_usage.format_usage(UNCOVERED_COMMAND)).toBeUndefined()
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

	it('prints the description alone for a command with no usage', () => {
		const help = command_usage.format_command_help(UNCOVERED_COMMAND) ?? ''

		expect(help).toContain(COMMAND_MAP[UNCOVERED_COMMAND]?.description)
		expect(help).not.toContain('```')
	})

	it('answers undefined for an unknown name', () => {
		expect(command_usage.format_command_help('not-a-command')).toBeUndefined()
	})
})
