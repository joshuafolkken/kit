import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const LEFTHOOK_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'lefthook')
const BASE_CONFIG = path.join(REPO_ROOT, 'lefthook', 'base.yml')
// A consumer reaches kit through `node_modules/@joshuafolkken/kit`, which `vanilla.yml` extends.
const KIT_LINK = path.join('node_modules', '@joshuafolkken', 'kit')
const DISTRIBUTED_CONFIGS = ['base.yml', 'vanilla.yml'] as const
const PRE_COMMIT_COMMANDS = [
	'prevent-main-commit',
	'cspell',
	'secretlint',
	'prettier',
	'eslint',
	'type-check',
]
const PRE_PUSH_COMMANDS = ['audit', 'test-unit']

const make_directory = temporary_directory()

// A git checkout standing in for a consumer, whose lefthook.yml extends one distributed config.
function make_consumer(config: string): string {
	const consumer = make_directory('lefthook-consumer-')

	spawnSync('git', ['init', '-q'], { cwd: consumer })
	mkdirSync(path.join(consumer, path.dirname(KIT_LINK)), { recursive: true })
	symlinkSync(REPO_ROOT, path.join(consumer, KIT_LINK))
	writeFileSync(
		path.join(consumer, 'lefthook.yml'),
		`extends:\n  - ${KIT_LINK}/lefthook/${config}\n`,
	)

	return consumer
}

function with_fail_text(commands: ReadonlyArray<string>): Record<string, unknown> {
	const entries = commands.map((command) => [
		command,
		expect.objectContaining({ fail_text: expect.any(String) }),
	])

	return Object.fromEntries(entries)
}

describe('distributed lefthook config', () => {
	it.each(DISTRIBUTED_CONFIGS)('passes lefthook validate when a consumer extends %s', (config) => {
		const result = spawnSync(LEFTHOOK_BIN, ['validate'], {
			cwd: make_consumer(config),
			encoding: 'utf8',
		})

		expect(result.stdout + result.stderr).toContain('All good')
		expect(result.status).toBe(0)
	})

	it('skips prevent-main-commit through a command that exits 0 when nothing is staged', () => {
		const config = load(readFileSync(BASE_CONFIG, 'utf8'))

		expect(config).toMatchObject({
			'pre-commit': {
				commands: { 'prevent-main-commit': { skip: [{ run: 'git diff --cached --quiet' }] } },
			},
		})
	})

	it('carries the failure guidance on every pre-commit and pre-push command, not on the hook', () => {
		const config = load(readFileSync(BASE_CONFIG, 'utf8'))

		expect(config).toMatchObject({
			'pre-commit': { commands: with_fail_text(PRE_COMMIT_COMMANDS) },
			'pre-push': { commands: with_fail_text(PRE_PUSH_COMMANDS) },
		})
		expect(config).not.toHaveProperty(['pre-commit', 'fail_text'])
		expect(config).not.toHaveProperty(['pre-push', 'fail_text'])
	})
})
