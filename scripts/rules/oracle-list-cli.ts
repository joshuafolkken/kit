#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { decision_oracle } from './decision-oracle'
import { oracle_firing } from './oracle-firing'

// `josh oracle:list` — print the decision oracles enumeration (joshuafolkken/kit#2117).
//
// A command rather than a paragraph: the criterion is `prompts/collaboration-workflow/residency.md`
// → question 0, and the list is what it points at. Adding an oracle here is the whole action;
// nothing else is updated.

const ARGV_OFFSET = 2
const INDENT = '  '
const FIELD_WIDTH = 10

function pad_field(label: string): string {
	return label.padEnd(FIELD_WIDTH)
}

// The firing point an oracle governs, or the reason none is named — one line either way, so `oracle:list`
// shows at a glance which oracles a guard enforces and which stay visibly unenforced (joshuafolkken/kit#2324).
function firing_line(oracle: (typeof decision_oracle.DECISION_ORACLES)[0]): string {
	const declaration = oracle_firing.declaration_for(oracle.name)

	if (declaration.firing_point !== undefined) {
		return `${INDENT}${INDENT}${pad_field('fires on')}${declaration.firing_point.describes}`
	}

	return `${INDENT}${INDENT}${pad_field('no firing')}${declaration.not_firing_reason ?? ''}`
}

function format_oracle(oracle: (typeof decision_oracle.DECISION_ORACLES)[0]): string {
	const command = decision_oracle.get_command(oracle)
	const command_with_args = oracle.args
		? `pnpm josh ${command} ${oracle.args}`
		: `pnpm josh ${command}`

	return [
		`${INDENT}${oracle.name}`,
		`${INDENT}${INDENT}${pad_field('decision')}${oracle.decision}`,
		`${INDENT}${INDENT}${pad_field('command')}${command_with_args}`,
		`${INDENT}${INDENT}${pad_field('answers')}${oracle.vocabulary.join(' | ')}`,
		firing_line(oracle),
		`${INDENT}${INDENT}${pad_field('source')}${oracle.single_source}`,
	].join('\n')
}

function print_list(): void {
	console.info('decision oracles:')

	for (const oracle of decision_oracle.DECISION_ORACLES) {
		console.info(format_oracle(oracle))
	}
}

function run(argv: ReadonlyArray<string>): number {
	if (argv.length > 0) {
		console.error('Usage: josh oracle:list')

		return 1
	}

	print_list()

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const oracle_list_cli = {
	format_oracle,
	main,
	print_list,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { oracle_list_cli }
