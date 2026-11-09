import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gh_usage_cli, type UsageContext } from './gh-usage-cli'
import { gh_usage_log } from './gh-usage-log'

const make_directory = temporary_directory()

const EARLY = '2026-11-01T00:00:00.000Z'
const LATE = '2026-11-08T00:00:00.000Z'
const TRANSPORT = 'graphql (auto)'

function capture(): { out: () => string; err: () => string } {
	const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const stderr = vi.spyOn(console, 'error').mockReturnValue()

	return {
		out: () => stdout.mock.calls.map(([text]) => String(text)).join(''),
		err: () => stderr.mock.calls.map(([text]) => String(text)).join('\n'),
	}
}

function seeded_repository(): string {
	const repository = make_directory('josh-gh-usage-cli-')
	const target = gh_usage_log.target_of(repository)

	for (const at of [EARLY, LATE]) {
		gh_usage_log.append(target, {
			at,
			command: 'run:step',
			calls: 3,
			not_modified: 0,
			elapsed_ms: 1,
		})
	}

	return repository
}

function context_of(repository?: string): UsageContext {
	return {
		repository_directory: () => Promise.resolve(repository),
		transport: () => Promise.resolve(TRANSPORT),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gh_usage_cli.run', () => {
	it("tallies the repository's usage log", async () => {
		const context = context_of(seeded_repository())
		const output = capture()

		await expect(gh_usage_cli.run([], context)).resolves.toBe(0)
		expect(output.out()).toContain(
			`gh:usage — ${EARLY} … ${LATE} · 2 lines · transport: ${TRANSPORT}\n`,
		)
		expect(output.out()).toContain('run:step     2      6    0       —\n')
	})

	it('narrows the lines to --since', async () => {
		const context = context_of(seeded_repository())
		const output = capture()

		await expect(gh_usage_cli.run(['--since', LATE], context)).resolves.toBe(0)
		expect(output.out()).toContain(
			`gh:usage — ${LATE} … ${LATE} · 1 lines · transport: ${TRANSPORT}\n`,
		)
	})

	it.each([[['--since', 'soon']], [['--until', LATE]], [['stray']]])(
		'prints the usage and exits non-zero for %j',
		async (argv) => {
			const context = context_of(seeded_repository())
			const output = capture()

			await expect(gh_usage_cli.run(argv, context)).resolves.toBe(1)
			expect(output.err()).toBe(gh_usage_cli.USAGE)
		},
	)

	it('exits non-zero outside a git repository', async () => {
		const context = context_of()
		const output = capture()

		await expect(gh_usage_cli.run([], context)).resolves.toBe(1)
		expect(output.err()).toBe('gh:usage — not in a git repository')
	})
})
