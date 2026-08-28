import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1005: every one of these commands writes its answer with a single `console.info`
// and is read as `answer=$(pnpm josh …)`. On macOS a write to a pipe is asynchronous, so
// `process.exit()` can tear the process down before it drains — `scripts/cost/cost-cli.ts` met that
// first and switched to `process.exitCode`.
//
// Asserted against the source because the defect has no observable behavior in a unit test: a
// reintroduced `process.exit()` passes every test and resurfaces only as truncated output in a real
// shell.

const HERE = path.dirname(fileURLToPath(import.meta.url))

const PIPED_ANSWER_COMMANDS = [
	'epic-next.ts',
	'epic-bundle-cli.ts',
	'epic-audit-cli.ts',
	'epic-plan-cli.ts',
] as const

// Comment lines are dropped before the check: every one of these files explains *why* it avoids
// `process.exit()`, and a search over the prose would match the explanation rather than a call.
function code_of(file: string): string {
	return readFileSync(path.join(HERE, file), 'utf8')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n')
}

describe('the epic commands whose answer is read from a pipe', () => {
	it.each(PIPED_ANSWER_COMMANDS)('%s sets process.exitCode', (file) => {
		expect(code_of(file)).toContain('process.exitCode =')
	})

	it.each(PIPED_ANSWER_COMMANDS)('%s never calls process.exit()', (file) => {
		expect(code_of(file)).not.toContain('process.exit(')
	})
})
