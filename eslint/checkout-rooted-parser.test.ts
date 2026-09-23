import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import ts from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'
import { create_base_config } from './base.js'
import { checkout_rooted_parser } from './checkout-rooted-parser.js'
import { config_fingerprint } from './config-fingerprint.js'

// joshuafolkken/kit#2435: the checkout's absolute path was part of ESLint's `hashOfConfig`, so a
// cache carried between the primary checkout and a lane never hit. These drive the real engine, so
// they take the same budget `base-resolution.test.ts` declares (joshuafolkken/kit#1755).
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const GITIGNORE_PATH = new URL('../.gitignore', import.meta.url)
// A second checkout location. Nothing exists there, which is the point of the cache-hit probe: a run
// that re-linted under it could not load the project and would report a fatal parse error.
const OTHER_CHECKOUT = path.join(tmpdir(), 'kit-other-checkout', 'kit')
const PROBE_FILE = 'eslint/checkout-rooted-parser.test.ts'
const SOURCE = 'const x = 1\n'
const HASH_OF_CONFIG = /"hashOfConfig":"(?<hash>[^"]+)"/u

function options_for(root: string, extra: Array<Linter.Config> = []): ESLint.Options {
	const config = [
		...create_base_config({ gitignore_path: GITIGNORE_PATH, tsconfig_root_dir: root }),
		...extra,
	]

	return { cwd: REPO_ROOT, overrideConfigFile: true, overrideConfig: config }
}

async function resolved_config(
	root: string,
	extra: Array<Linter.Config> = [],
): Promise<Linter.Config> {
	const config: Linter.Config = await new ESLint(options_for(root, extra)).calculateConfigForFile(
		PROBE_FILE,
	)

	return config
}

async function serialized_config(root: string, extra: Array<Linter.Config> = []): Promise<string> {
	return JSON.stringify(await resolved_config(root, extra))
}

async function cached_hash(root: string, cache_location: string): Promise<string | undefined> {
	const cached = new ESLint({ ...options_for(root), cache: true, cacheLocation: cache_location })
	const [result] = await cached.lintFiles([PROBE_FILE])

	expect(result?.messages.filter((message) => message.fatal === true)).toStrictEqual([])

	return HASH_OF_CONFIG.exec(readFileSync(cache_location, 'utf8'))?.groups?.['hash']
}

describe('checkout_rooted_parser.create', () => {
	it('hands the checkout root to typescript-eslint, under any option the caller set', () => {
		const parse = vi.spyOn(ts.parser, 'parseForESLint')

		checkout_rooted_parser.create(REPO_ROOT).parseForESLint(SOURCE, { range: true })

		expect(parse).toHaveBeenCalledWith(SOURCE, { tsconfigRootDir: REPO_ROOT, range: true })
		parse.mockRestore()
	})

	it('lets an explicit tsconfigRootDir win over the checkout root', () => {
		const parse = vi.spyOn(ts.parser, 'parseForESLint')

		checkout_rooted_parser.create(OTHER_CHECKOUT).parseForESLint('', { tsconfigRootDir: REPO_ROOT })

		expect(parse).toHaveBeenCalledWith('', { tsconfigRootDir: REPO_ROOT })
		parse.mockRestore()
	})
})

describe('create_base_config — the serialized config across checkouts', () => {
	it('serializes the same config for two checkouts at different paths', async () => {
		const [here, there] = await Promise.all([
			serialized_config(REPO_ROOT),
			serialized_config(OTHER_CHECKOUT),
		])

		expect(here).not.toContain(REPO_ROOT)
		expect(there).toBe(here)
	})

	it('hits a cache warmed in one checkout from another without re-linting', async () => {
		const cache_directory = mkdtempSync(path.join(tmpdir(), 'kit-lane-cache-'))
		const cache_location = path.join(cache_directory, '.eslintcache')
		const warmed = await cached_hash(REPO_ROOT, cache_location)
		const reused = await cached_hash(OTHER_CHECKOUT, cache_location)

		expect(warmed).toBeDefined()
		expect(reused).toBe(warmed)
	})

	it('still changes the hash when a rule module changes (joshuafolkken/kit#1347)', async () => {
		const edited = { settings: { [config_fingerprint.SETTINGS_KEY]: 'edited' } }
		const [before, after] = await Promise.all([
			serialized_config(REPO_ROOT),
			serialized_config(REPO_ROOT, [edited]),
		])

		expect(after).not.toBe(before)
	})
})

describe('create_base_config — a consumer block after it', () => {
	it('deep-merges a consumer block that adds a parser option for the same files', async () => {
		const consumer = {
			files: ['**/*.ts'],
			languageOptions: { parserOptions: { extraFileExtensions: ['.svelte'] } },
		}
		const config = await resolved_config(REPO_ROOT, [consumer])

		expect(config.languageOptions?.['parserOptions']).toMatchObject({
			project: './tsconfig.json',
			extraFileExtensions: ['.svelte'],
		})
	})
})
