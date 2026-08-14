import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prettier_format_json } from '#scripts/config-merge/prettier-json-fixture'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const TEST_DIR = path.join(tmpdir(), 'sync-configs-tsconfig-test')
const TSCONFIG_DEST = path.join(TEST_DIR, 'tsconfig.json')
const ENTRY = init_logic.get_tsconfig_extends_entry()
const NO_EMIT_ON_ERROR = 'noEmitOnError'

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function sync_and_read_raw(content: string): string {
	writeFileSync(TSCONFIG_DEST, content)
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	sync_configs.sync_tsconfig(TSCONFIG_DEST)

	return readFileSync(TSCONFIG_DEST, 'utf8')
}

function sync_and_read(content: string): Record<string, unknown> {
	return JSON.parse(sync_and_read_raw(content)) as Record<string, unknown>
}

// Every sync now also union-merges the generated-output directories into `exclude` (#712). The
// extends / compilerOptions assertions below are about their own concern, so they compare against
// the rest of the file with that expected addition folded in.
function with_kit_exclude(expected: Record<string, unknown>): Record<string, unknown> {
	return { ...expected, exclude: [...init_logic.get_tsconfig_exclude_entries()] }
}

describe('sync_configs.sync_tsconfig — normalization', () => {
	it('strips compilerOptions that duplicate the base preset', () => {
		const content = `${JSON.stringify({
			extends: [ENTRY],
			compilerOptions: { strict: true, esModuleInterop: true },
		})}\n`

		expect(sync_and_read(content)).toStrictEqual(with_kit_exclude({ extends: [ENTRY] }))
	})

	it('preserves a value-divergent override while stripping redundant keys', () => {
		const content = `${JSON.stringify({
			extends: [ENTRY],
			compilerOptions: { strict: true, [NO_EMIT_ON_ERROR]: false },
		})}\n`
		const result = sync_and_read(content) as { compilerOptions: Record<string, unknown> }

		expect(result.compilerOptions).toStrictEqual({ [NO_EMIT_ON_ERROR]: false })
	})

	it('logs unchanged when already minimal with no redundant options', () => {
		const content = `${JSON.stringify(with_kit_exclude({ extends: [ENTRY] }), undefined, '\t')}\n`

		writeFileSync(TSCONFIG_DEST, content)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync_configs.sync_tsconfig(TSCONFIG_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(TSCONFIG_DEST, 'utf8')).toBe(content)
	})
})

// A consumer upgrading from a kit that shipped `*.jsonc` presets cannot start Playwright at all
// until its `extends` points at the `.json` path, and the ecosystem-preset check would otherwise
// consider the stale entry "already present" and leave it alone. `josh sync` must repair it (#681).
const KIT_LEGACY = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const APP_KIT_LEGACY = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const APP_KIT_CURRENT = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'

function install_preset(relative_path: string): void {
	const absolute = path.join(TEST_DIR, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '{ "compilerOptions": {} }\n')
}

describe('sync_configs.sync_tsconfig — legacy .jsonc preset migration', () => {
	it('rewrites a stale kit preset path to the shipped .json preset', () => {
		install_preset(ENTRY)
		const content = `${JSON.stringify({ extends: [KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual(with_kit_exclude({ extends: [ENTRY] }))
	})

	it('rewrites a stale app-kit preset path without adding kit base', () => {
		install_preset(APP_KIT_CURRENT)
		const content = `${JSON.stringify({ extends: [APP_KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual(with_kit_exclude({ extends: [APP_KIT_CURRENT] }))
	})

	// Until the package shipping the renamed preset is installed, rewriting would point tsc at a
	// file that does not exist — strictly worse than leaving the stale entry in place (#681).
	it('leaves a stale entry alone while the renamed preset is not installed', () => {
		const content = `${JSON.stringify({ extends: [APP_KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual(with_kit_exclude({ extends: [APP_KIT_LEGACY] }))
	})
})

const KIT_EXCLUDE = [...init_logic.get_tsconfig_exclude_entries()]
const PLAYWRIGHT_REPORT_DIR = 'playwright-report'
const CONSUMER_ONLY_EXCLUDE = 'legacy-vendor'

// A prettier-clean consumer file — the state kit's own distributed pre-commit hook enforces, so the
// state every managed project is actually in. Written out literally rather than generated from the
// serializer under test; the precondition case below is what proves the literal is right.
const PRETTIER_CLEAN_TSCONFIG = `{
	"extends": ["./node_modules/@joshuafolkken/kit/tsconfig/base.json"],
	"compilerOptions": {
		"strict": true
	},
	"exclude": [
		"node_modules",
		"build",
		"dist",
		"playwright-report",
		"test-results",
		"src/service-worker.js",
		"src/service-worker/**/*.js",
		"src/service-worker.ts",
		"src/service-worker/**/*.ts",
		"src/service-worker.d.ts",
		"src/service-worker/**/*.d.ts"
	]
}
`

const SV_CREATE_COMMENT = '// Path aliases are handled by svelte.config.js'
const EXCLUDE_LINE_START = '\t"exclude"'

describe('sync_configs.sync_tsconfig — prettier-clean serialization', () => {
	// Without this the two cases below could pass on a fixture prettier would have reformatted, which
	// would make "leaves prettier nothing to do" a statement about nothing.
	it('starts from a fixture real prettier already leaves unchanged', async () => {
		expect(await prettier_format_json(PRETTIER_CLEAN_TSCONFIG)).toBe(PRETTIER_CLEAN_TSCONFIG)
	})

	// A file sync rewrites must come back prettier-clean, or the consumer's own `prettier --check`
	// fails on a file they never touched (#660). Assert that against real prettier rather than the
	// layout a particular entry count produces — the `exclude` array outgrew one line when the
	// SvelteKit exclusions joined it (#796), and the intent did not change with it.
	//
	// The guarantee is conditional now, and the input above is why: since #798 a rewrite edits only
	// the value it changes and passes every other byte through, so kit no longer reformats a document
	// it did not author. A file that arrives prettier-clean leaves prettier-clean; one that arrives
	// malformed keeps its own layout instead of being silently normalized — which is the same trade
	// that lets a consumer's comments survive.
	it('rewrites a prettier-clean file to one prettier still leaves unchanged', async () => {
		const result = sync_and_read(PRETTIER_CLEAN_TSCONFIG)
		const written = readFileSync(TSCONFIG_DEST, 'utf8')

		expect(result).toStrictEqual({ extends: [ENTRY], exclude: KIT_EXCLUDE })
		expect(await prettier_format_json(written)).toBe(written)
	})

	// The kit#798 regression, end to end through the real sync: `sv create` ships this comment, and
	// the whole-file write-back used to delete it the first time sync had anything to add.
	it('leaves a comment in the consumer file intact while stripping a redundant option', () => {
		const content = PRETTIER_CLEAN_TSCONFIG.split(EXCLUDE_LINE_START).join(
			`\t${SV_CREATE_COMMENT}\n${EXCLUDE_LINE_START}`,
		)

		expect(sync_and_read_raw(content)).toContain(SV_CREATE_COMMENT)
	})
})

// Every existing consumer already has a tsconfig, so a merge that only writes new files would leave
// the whole installed base type-checking Playwright's generated report bundle (#712).
describe('sync_configs.sync_tsconfig — generated-output exclude', () => {
	it('repairs a consumer whose exclude predates the generated-output entries', () => {
		const content = `${JSON.stringify({ extends: [ENTRY], exclude: ['node_modules'] })}\n`
		const result = sync_and_read(content) as { exclude: Array<string> }

		expect(result.exclude).toStrictEqual(KIT_EXCLUDE)
	})

	it('adds the entries to a consumer that declared no exclude at all', () => {
		const content = `${JSON.stringify({ extends: [ENTRY] })}\n`
		const result = sync_and_read(content) as { exclude: Array<string> }

		expect(result.exclude).toContain(PLAYWRIGHT_REPORT_DIR)
	})

	it('preserves an exclude entry kit does not own', () => {
		const content = `${JSON.stringify({ extends: [ENTRY], exclude: [CONSUMER_ONLY_EXCLUDE] })}\n`
		const result = sync_and_read(content) as { exclude: Array<string> }

		expect(result.exclude[0]).toBe(CONSUMER_ONLY_EXCLUDE)
		expect(result.exclude).toContain(PLAYWRIGHT_REPORT_DIR)
	})

	it('logs unchanged when the exclude already carries every entry', () => {
		const content = `${JSON.stringify({ extends: [ENTRY], exclude: KIT_EXCLUDE }, undefined, '\t')}\n`

		writeFileSync(TSCONFIG_DEST, content)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync_configs.sync_tsconfig(TSCONFIG_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
	})
})
