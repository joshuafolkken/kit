import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const LEFTHOOK = 'lefthook'
const CSPELL = 'cspell'
const OLDER_RANGE = '^1.0.0'

const ctx = { work_directory: '', package_json_path: '' }

function read_development_deps(): Record<string, string> {
	const parsed = JSON.parse(readFileSync(ctx.package_json_path, 'utf8')) as {
		devDependencies?: Record<string, string>
	}

	return parsed.devDependencies ?? {}
}

function sync_manifest(content: string): Record<string, string> {
	writeFileSync(ctx.package_json_path, content)
	sync.sync_consumer_resolved_development_deps(ctx.package_json_path)

	return read_development_deps()
}

function printed_lines(): Array<string> {
	return vi.mocked(console.info).mock.calls.map(([line]) => String(line))
}

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-toolchain-'))
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	mkdirSync(path.join(ctx.work_directory, '.git'))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync.sync_consumer_resolved_development_deps', () => {
	// `josh sync` reaches consumers initialized before `josh init` added lefthook: they got
	// `lefthook.yml` and no lefthook to run it.
	it('adds a missing tool and asks for the install', () => {
		const deps = sync_manifest('{\n\t"name": "demo"\n}\n')

		expect(deps[LEFTHOOK]).toBeDefined()
		expect(deps[CSPELL]).toBeDefined()
		expect(printed_lines().join('\n')).toContain('run `pnpm install`')
	})

	it('leaves the range the consumer chose', () => {
		const content = `{"devDependencies":{"${LEFTHOOK}":"${OLDER_RANGE}"}}`

		expect(sync_manifest(content)[LEFTHOOK]).toBe(OLDER_RANGE)
	})

	it('does not repeat under devDependencies a tool listed under dependencies', () => {
		const content = `{"dependencies":{"${CSPELL}":"${OLDER_RANGE}"}}`

		expect(sync_manifest(content)[CSPELL]).toBeUndefined()
	})

	it('adds no lefthook beside a manifest that has no Git repository', () => {
		rmSync(path.join(ctx.work_directory, '.git'), { recursive: true })
		const deps = sync_manifest('{}\n')

		expect(deps[LEFTHOOK]).toBeUndefined()
		expect(deps[CSPELL]).toBeDefined()
	})

	it('leaves a manifest it has nothing to add to byte-identical on the second run', () => {
		sync_manifest('{}\n')
		const first = readFileSync(ctx.package_json_path, 'utf8')

		sync.sync_consumer_resolved_development_deps(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(first)
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_consumer_resolved_development_deps(ctx.package_json_path)
		}).not.toThrow()
	})
})

describe('sync.sync_package_json_migrations', () => {
	it('runs the toolchain migration as one of the manifest migrations josh sync applies', () => {
		writeFileSync(ctx.package_json_path, '{}\n')
		sync.sync_package_json_migrations(ctx.package_json_path)

		expect(read_development_deps()[LEFTHOOK]).toBeDefined()
	})
})
