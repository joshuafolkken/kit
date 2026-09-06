import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { release_cli } from './release-cli'
import type { ReleasePlan } from './release-plan'
import { release_publish } from './release-publish'

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SCRIPT_NAME = 'release-cli.ts'
const NODE = 'node'
const RELEASE_BRANCH = 'release/v1.342.0'
const THREE = 3
const PLAN: ReleasePlan = {
	base: 'abcdef1234567890',
	pending: THREE,
	current_version: '1.339.0',
	next_version: '1.342.0',
}

function read_repository_file(relative_path: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, relative_path), 'utf8')
}

describe('the josh release command entry', () => {
	it('is documented', () => {
		expect(read_repository_file('docs/josh-commands.md')).toContain('`josh release`')
	})
})

describe('release_cli.is_dry_run_requested', () => {
	it('reads the flag out of argv', () => {
		expect(release_cli.is_dry_run_requested([NODE, SCRIPT_NAME, release_cli.DRY_RUN_FLAG])).toBe(
			true,
		)
	})

	it('is false without it', () => {
		expect(release_cli.is_dry_run_requested([NODE, SCRIPT_NAME])).toBe(false)
	})

	// argv[0] and argv[1] name the runtime and the script, never an option, so a path that happened
	// to read as the flag must not turn a real release into a rehearsal.
	it('ignores anything before the arguments', () => {
		expect(release_cli.is_dry_run_requested([release_cli.DRY_RUN_FLAG, SCRIPT_NAME])).toBe(false)
	})
})

describe('the release pull request', () => {
	it('is branched and titled by the version it ships', () => {
		expect(release_publish.branch_name_for(PLAN.next_version)).toBe(RELEASE_BRANCH)
		expect(release_publish.commit_message(PLAN.next_version)).toBe('Release v1.342.0')
	})

	it('says how many merges it carries and from which commit', () => {
		const body = release_publish.pull_request_body(PLAN)

		expect(body).toContain('3 merge(s)')
		expect(body).toContain(PLAN.base)
		expect(body).toContain(PLAN.next_version)
	})

	// A release carries whatever merged since the last one, so it closes no single issue — and a
	// `closes #N` here would close an unrelated issue of that number.
	it('carries no closes reference', () => {
		expect(release_publish.pull_request_body(PLAN)).not.toContain('closes #')
	})

	// A branch already there is a previous attempt that got as far as opening one, so the message
	// says what to do about it rather than leaving git's `a branch named … already exists` to.
	it('explains a branch left behind by an earlier attempt', () => {
		const text = release_publish.existing_branch_message(RELEASE_BRANCH)

		expect(text).toContain(RELEASE_BRANCH)
		expect(text).toContain('previous release attempt')
		expect(text).toContain('pnpm josh release')
	})
})
