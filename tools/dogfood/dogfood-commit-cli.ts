#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { dogfood_commit } from './dogfood-commit'

// `josh dogfood:commit <dir>` — the I/O around `dogfood-commit.ts`: one refusal line or the commit.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh dogfood:commit <dir>'
const FAILURE_EXIT_CODE = 1

function run(argv: ReadonlyArray<string>, kit_root: string = PACKAGE_DIR): number {
	const [target] = argv

	if (target === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reason = dogfood_commit.refusal(target, kit_root)

	if (reason !== undefined) {
		console.error(`Refusing to commit ${target}: ${reason}. Nothing was changed.`)

		return FAILURE_EXIT_CODE
	}

	dogfood_commit.commit(target)

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const dogfood_commit_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { dogfood_commit_cli }
