#!/usr/bin/env tsx
import { josh_logic } from './josh-logic'

const ARGV_OFFSET = 2

function print_help(): void {
	console.info(josh_logic.format_help())
}

function handle_unknown(cmd: string): never {
	console.error(`Unknown command: ${cmd}\n`)
	print_help()
	process.exit(1)
}

function main(): void {
	const cmd = process.argv[ARGV_OFFSET]
	const subcommand_arguments = process.argv.slice(ARGV_OFFSET + 1)

	if (!cmd || cmd === 'help') {
		print_help()

		return
	}

	const exit_code = josh_logic.run_command(cmd, subcommand_arguments)

	if (exit_code === -1) handle_unknown(cmd)
	if (exit_code !== 0) process.exit(exit_code)
}

main()
