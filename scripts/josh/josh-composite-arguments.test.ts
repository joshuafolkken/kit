import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import type { CommandEntry } from './josh-command-types'
import { composite_arguments } from './josh-composite-arguments'

const WORKERS_FLAG = '--workers=1'
const TEST_CMD = 'test'

const COMPOSITE_ENTRY: CommandEntry = {
	shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
	description: 'Run unit and E2E tests',
	category: 'Development',
	argument_targets: ['test:unit', 'test:e2e'],
}

const NO_TARGET_ENTRY: CommandEntry = {
	shell: ['sh', '-c', 'git checkout main && git pull'],
	description: 'Checkout default branch and pull latest',
	category: 'Workflow',
}

const DIRECT_ENTRY: CommandEntry = {
	shell: ['pnpm', 'exec', 'prettier', '--check', '.'],
	description: 'Check formatting with prettier',
	category: 'Development',
}

const SCRIPT_ENTRY: CommandEntry = {
	script: 'scripts/test-e2e-guard.ts',
	description: 'Run E2E tests with Playwright',
	category: 'Development',
}

describe('composite_arguments.is_composite_shell', () => {
	it('recognizes the sh -c form that swallows appended arguments', () => {
		expect(composite_arguments.is_composite_shell(COMPOSITE_ENTRY.shell)).toBe(true)
	})

	it('does not treat a direct tool invocation as composite', () => {
		expect(composite_arguments.is_composite_shell(DIRECT_ENTRY.shell)).toBe(false)
	})

	it('does not treat a script entry without a shell as composite', () => {
		expect(composite_arguments.is_composite_shell(SCRIPT_ENTRY.shell)).toBe(false)
	})

	// `sh` alone would run an interactive shell rather than a fixed script, so the flag matters.
	it('requires the -c flag, not just the sh interpreter', () => {
		expect(composite_arguments.is_composite_shell(['sh', 'script.sh'])).toBe(false)
	})

	// An absolute interpreter path swallows arguments exactly like the bare name, so matching the
	// literal string `sh` would leave `/bin/sh -c` free to discard them again.
	it('recognizes an absolute interpreter path', () => {
		expect(composite_arguments.is_composite_shell(['/bin/sh', '-c', 'echo hi'])).toBe(true)
	})

	it('recognizes other POSIX shells used with -c', () => {
		expect(composite_arguments.is_composite_shell(['bash', '-c', 'echo hi'])).toBe(true)
		expect(composite_arguments.is_composite_shell(['/usr/bin/zsh', '-c', 'echo hi'])).toBe(true)
	})

	it('does not treat a non-shell tool called with -c as composite', () => {
		expect(composite_arguments.is_composite_shell(['tsc', '-c', 'tsconfig.json'])).toBe(false)
	})

	it('does not treat an empty shell array as composite', () => {
		expect(composite_arguments.is_composite_shell([])).toBe(false)
	})
})

describe('composite_arguments.reject_extra_arguments', () => {
	it('allows a composite command invoked with no extra arguments', () => {
		expect(
			composite_arguments.reject_extra_arguments(TEST_CMD, COMPOSITE_ENTRY, []),
		).toBeUndefined()
	})

	// Having no sub-command to redirect to is not a license to swallow the arguments.
	it('rejects a composite that has no sub-command to redirect to', () => {
		expect(
			composite_arguments.reject_extra_arguments('main:sync', NO_TARGET_ENTRY, [WORKERS_FLAG]),
		).toBeDefined()
	})

	it('allows a direct command to keep forwarding its arguments', () => {
		expect(
			composite_arguments.reject_extra_arguments('lint:prettier', DIRECT_ENTRY, [WORKERS_FLAG]),
		).toBeUndefined()
	})

	it('allows a script command to keep forwarding its arguments', () => {
		expect(
			composite_arguments.reject_extra_arguments('test:e2e', SCRIPT_ENTRY, [WORKERS_FLAG]),
		).toBeUndefined()
	})

	it('rejects a composite command that was given extra arguments', () => {
		const message = composite_arguments.reject_extra_arguments(TEST_CMD, COMPOSITE_ENTRY, [
			WORKERS_FLAG,
		])

		expect(message).toBeDefined()
	})
})

const EXPECTED_COMPOSITES: ReadonlyArray<string> = [
	'format',
	'latest',
	'main:merge',
	'main:sync',
	TEST_CMD,
]

function collect_composite_entries(): Array<[string, CommandEntry]> {
	return Object.entries(COMMAND_MAP).filter(([, entry]) =>
		composite_arguments.is_composite_shell(entry.shell),
	)
}

function collect_suggested_targets(): Array<string> {
	return Object.values(COMMAND_MAP).flatMap((entry) => [...(entry.argument_targets ?? [])])
}

describe('COMMAND_MAP composite commands', () => {
	// #733 surfaced in `test`, but the silent discard is a property of the `sh -c` shape rather than
	// of that one command. Auditing the whole map keeps a composite added later from shipping with
	// the same hole — the audit then runs on every commit instead of once inside an issue.
	it('every sh -c command refuses extra arguments', () => {
		const composites = collect_composite_entries()

		expect(composites.length).toBeGreaterThan(0)

		for (const [cmd, entry] of composites) {
			expect(composite_arguments.reject_extra_arguments(cmd, entry, [WORKERS_FLAG])).toBeDefined()
		}
	})

	it('covers the composites that exist today', () => {
		const names = collect_composite_entries().map(([cmd]) => cmd)

		expect(names.toSorted((left, right) => left.localeCompare(right))).toStrictEqual(
			EXPECTED_COMPOSITES,
		)
	})

	// A hint pointing at a command that does not exist is worse than no hint: the user retypes it
	// and gets "Unknown command".
	it('every suggested target is a real command', () => {
		const targets = collect_suggested_targets()

		expect(targets.length).toBeGreaterThan(0)

		for (const target of targets) expect(COMMAND_MAP).toHaveProperty(target)
	})

	// A suggested target must be able to receive what the composite refused, which rules out
	// pointing at another composite.
	it('no suggested target is itself a composite command', () => {
		for (const target of collect_suggested_targets()) {
			expect(composite_arguments.is_composite_shell(COMMAND_MAP[target]?.shell)).toBe(false)
		}
	})
})

describe('composite_arguments.format_rejection', () => {
	it('names the sub-commands that accept the arguments instead', () => {
		const message = composite_arguments.format_rejection('test', ['test:unit', 'test:e2e'])

		expect(message).toContain('josh test takes no extra arguments')
		expect(message).toContain('josh test:unit')
		expect(message).toContain('josh test:e2e')
	})

	it('joins three targets so every stage of a chain is offered', () => {
		const message = composite_arguments.format_rejection('latest', [
			'latest:corepack',
			'latest:update',
			'audit',
		])

		expect(message).toContain('josh latest:corepack or josh latest:update or josh audit')
	})

	// `main:sync` chains raw git calls, so there is no sub-command to redirect the user to; the
	// message still has to say the arguments were refused rather than trailing off.
	it('states that nothing is forwarded when no sub-command accepts the arguments', () => {
		const message = composite_arguments.format_rejection('main:sync', [])

		expect(message).toContain('josh main:sync takes no extra arguments')
		expect(message).toContain('forwards nothing')
	})
})
