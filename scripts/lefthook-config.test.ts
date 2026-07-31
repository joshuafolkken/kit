import { readFileSync } from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface LefthookCommand {
	run?: string
	glob?: string
}

interface LefthookHook {
	parallel?: boolean
	commands?: Record<string, LefthookCommand>
}

type LefthookConfig = Record<string, LefthookHook>

const BASE_LEFTHOOK = path.join('lefthook', 'base.yml')
const VANILLA_LEFTHOOK = path.join('lefthook', 'vanilla.yml')
const PRE_COMMIT = 'pre-commit'
const PRE_PUSH = 'pre-push'
const CSPELL = 'cspell'
const SECRETLINT = 'secretlint'
// lefthook resolves a nested `extends` from the consumer git root, so kit presets must reference
// base by this root-relative node_modules path — not the file-relative `./base.yml` that lefthook
// silently drops in consumers (kit#629).
const ROOT_RELATIVE_BASE = 'node_modules/@joshuafolkken/kit/lefthook/base.yml'
const FILE_RELATIVE_BASE = './base.yml'

function load_config(relative_path: string): LefthookConfig {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')

	return load(content) as LefthookConfig
}

function load_extends(relative_path: string): ReadonlyArray<string> {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
	const parsed = load(content) as { extends?: ReadonlyArray<string> }

	return parsed.extends ?? []
}

function load_pre_commit_command(
	relative_path: string,
	command_name: string,
): LefthookCommand | undefined {
	return load_config(relative_path)[PRE_COMMIT]?.commands?.[command_name]
}

function load_cspell_command(relative_path: string): LefthookCommand | undefined {
	return load_pre_commit_command(relative_path, CSPELL)
}

describe('lefthook/base.yml pre-commit cspell glob', () => {
	const cspell = load_cspell_command(BASE_LEFTHOOK)

	it('defines a cspell pre-commit command', () => {
		expect(cspell).toBeDefined()
	})

	it('includes .properties so kit-generated sonar-project.properties is checked locally like CI', () => {
		expect(cspell?.glob).toContain('properties')
	})
})

describe('lefthook/base.yml pre-commit secretlint command', () => {
	const secretlint = load_pre_commit_command(BASE_LEFTHOOK, SECRETLINT)
	const run = secretlint?.run ?? ''

	it('defines a secretlint pre-commit command', () => {
		expect(secretlint).toBeDefined()
	})

	// Scanning the whole tree on every commit would be slow enough that contributors
	// disable the hook, which is the failure mode this check exists to prevent.
	it('scans only the staged files', () => {
		expect(run).toContain('{staged_files}')
	})

	// secretlint resolves from the consumer project, so a kit upgrade activates this hook
	// before `josh sync` + `pnpm install` provisions the binary. A bare `pnpm exec secretlint`
	// hard-fails in that window and blocks every commit (kit#695); the wrapper skips instead.
	// The CLI flags moved with it — they are asserted in scripts/secretlint-scan.test.ts.
	it('delegates to the josh wrapper instead of invoking the binary directly', () => {
		expect(run).toContain('josh secretlint-scan')
	})

	it('does not invoke secretlint through a bare pnpm exec', () => {
		expect(run).not.toContain('pnpm exec secretlint')
	})

	// An unscoped glob would make secretlint scan files unrelated to the commit.
	it('does not restrict the command with a glob filter', () => {
		expect(secretlint?.glob).toBeUndefined()
	})
})

describe('lefthook/base.yml pre-push parallel (kit#676)', () => {
	const pre_push = load_config(BASE_LEFTHOOK)[PRE_PUSH]

	// Enabled in kit#676 after auditing every active consumer: each has at most one
	// preview-owning pre-push command (app-kit's unified `verify`, or a single `test-e2e`),
	// so nothing collides on the fixed preview port. Revert to false only if a consumer
	// reintroduces 2+ colliding preview-owning commands. This assertion guards that decision
	// against an accidental flip back.
	it('runs pre-push commands in parallel', () => {
		expect(pre_push?.parallel).toBe(true)
	})
})

describe('lefthook/vanilla.yml base extends resolution (kit#629)', () => {
	const extends_list = load_extends(VANILLA_LEFTHOOK)

	it('references kit base by a root-relative node_modules path so it resolves in consumers', () => {
		expect(extends_list).toContain(ROOT_RELATIVE_BASE)
	})

	it('does not use the file-relative ./base.yml form that lefthook silently drops in consumers', () => {
		expect(extends_list).not.toContain(FILE_RELATIVE_BASE)
	})
})
