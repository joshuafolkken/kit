#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_logic, USAGE_ERROR_EXIT_CODE } from './josh-logic'

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh completion --names'

function main(): void {
	const cli_arguments = process.argv.slice(ARGV_OFFSET)

	if (cli_arguments.length !== 1 || cli_arguments[0] !== '--names') {
		console.error(USAGE)
		process.exitCode = USAGE_ERROR_EXIT_CODE

		return
	}

	console.info(josh_logic.all_command_names().join('\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
