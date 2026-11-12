#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_completion_scripts } from './josh-completion-scripts'
import { josh_logic, USAGE_ERROR_EXIT_CODE } from './josh-logic'

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh completion --names | josh completion <zsh|bash|fish>'

function output_for(argument: string): string | undefined {
	if (argument === '--names') return josh_logic.all_command_names().join('\n')

	return josh_completion_scripts.completion_script(argument)
}

function main(): void {
	const [argument, ...rest] = process.argv.slice(ARGV_OFFSET)
	const output = argument === undefined || rest.length > 0 ? undefined : output_for(argument)

	if (output === undefined) {
		console.error(USAGE)
		process.exitCode = USAGE_ERROR_EXIT_CODE

		return
	}

	console.info(output)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
