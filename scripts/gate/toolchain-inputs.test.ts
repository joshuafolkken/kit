import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { eslint_daemon } from '#scripts/lint/eslint-daemon'
import { metrics_base_cache } from '#tools/metrics/metrics-base-cache'
import { afterAll, describe, expect, it, onTestFinished } from 'vitest'
import { toolchain_inputs } from './toolchain-inputs'

// joshuafolkken/kit#4496: one list of toolchain inputs, read by every result kept across runs.

const scratch = mkdtempSync(path.join(tmpdir(), 'toolchain-inputs-test-'))
const MANIFEST = 'package.json'
const CONFIG_ENTRY = 'eslint.config.js'
const TSCONFIG = 'tsconfig.json'
const RULE_MODULE = 'eslint/rules/a-rule.js'
const RULE_TEST = 'eslint/rules/a-rule.test.js'
const OUTPUT_NAME = 'hook.js'
const COMMIT = 'base-commit'
const DAEMON = 'token 1234 99 hash'
const INSTALL_RECORD = 'node_modules/.modules.yaml'
const JSON_BODY = '{}\n'
const ADDED_INPUTS = [
	'pnpm-workspace.yaml',
	INSTALL_RECORD,
	'tsconfig.build.json',
	'eslint/rules/added-rule.js',
	'tsconfig/strict.json',
]

function file(root: string, relative: string, text: string): void {
	mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
	writeFileSync(path.join(root, relative), text)
}

function project(): string {
	const root = mkdtempSync(path.join(scratch, 'root-'))

	file(root, MANIFEST, JSON_BODY)
	file(root, CONFIG_ENTRY, 'export default []\n')
	file(root, RULE_MODULE, 'export const rule = {}\n')
	file(root, 'src/a.ts', 'export const a = 1\n')

	return root
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('toolchain_inputs.is_input', () => {
	it.each([MANIFEST, 'pnpm-lock.yaml', CONFIG_ENTRY, 'eslint.config.mts', RULE_MODULE])(
		'reads %s',
		(relative) => {
			expect(toolchain_inputs.is_input(relative)).toBe(true)
		},
	)

	it.each([TSCONFIG, 'tsconfig.app.json', 'tsconfig/base.json', INSTALL_RECORD])(
		'reads %s',
		(relative) => {
			expect(toolchain_inputs.is_input(relative)).toBe(true)
		},
	)

	it.each(['src/eslint.ts', 'scripts/package.json', RULE_TEST])('leaves %s alone', (relative) => {
		expect(toolchain_inputs.is_input(relative)).toBe(false)
	})
})

describe('toolchain_inputs.paths', () => {
	it('lists the inputs present, in code-unit order, without a test beside the rules', () => {
		const root = project()

		file(root, RULE_TEST, 'export {}\n')

		expect(toolchain_inputs.paths(root)).toStrictEqual([CONFIG_ENTRY, RULE_MODULE, MANIFEST])
	})
})

describe('toolchain_inputs.digest', () => {
	it('stays the same while nothing it lists moved', () => {
		const root = project()
		const before = toolchain_inputs.digest(root)

		file(root, 'src/a.ts', 'export const a = 2\n')
		file(root, RULE_TEST, 'export {}\n')

		expect(toolchain_inputs.digest(root)).toBe(before)
	})

	it('moves when a listed input is edited', () => {
		const root = project()
		const before = toolchain_inputs.digest(root)

		file(root, RULE_MODULE, 'export const rule = { changed: true }\n')

		expect(toolchain_inputs.digest(root)).not.toBe(before)
	})

	// An editor's atomic save or a checkout mid-run leaves an entry listed and then gone.
	it('hashes an input gone by the time it is read rather than failing', () => {
		const root = project()

		symlinkSync(path.join(root, 'missing.json'), path.join(root, TSCONFIG))

		expect(() => toolchain_inputs.digest(root)).not.toThrow()
	})
})

interface Kept {
	root: string
	out_directory: string
	daemon_record: string
}

function keep_metrics(root: string): void {
	const cache_path = metrics_base_cache.cache_path(COMMIT, root)

	metrics_base_cache.write(COMMIT, root, { stdout: '{}', approvals: [] })
	onTestFinished(() => {
		stamp_file.remove_stamp(cache_path)
	})
}

// Stamped from the inputs' real bytes, as `build-hooks.ts` records them.
function keep_hooks(root: string, out_directory: string): void {
	const sources = new Map(
		toolchain_inputs
			.paths(root)
			.map((relative) => [relative, readFileSync(path.join(root, relative))]),
	)

	file(out_directory, OUTPUT_NAME, 'export {}\n')
	writeFileSync(
		path.join(out_directory, hook_bundle_stamp.STAMP_NAME),
		hook_bundle_stamp.stamp_text(sources, [OUTPUT_NAME]),
	)
}

// Each kept result, recorded for `root` as it stands now.
function keep_all(root: string): Kept {
	const out_directory = path.join(root, 'dist', 'hooks')

	keep_metrics(root)
	keep_hooks(root, out_directory)

	return {
		root,
		out_directory,
		daemon_record: eslint_daemon.record_text(DAEMON, eslint_daemon.fingerprint(root)),
	}
}

function reused(kept: Kept): ReadonlyArray<boolean> {
	const { root, out_directory, daemon_record } = kept
	const record = { daemon: DAEMON, recorded: daemon_record }

	return [
		metrics_base_cache.read(COMMIT, root) !== undefined,
		hook_bundle_stamp.is_fresh(out_directory, root),
		!eslint_daemon.is_stale(record, eslint_daemon.fingerprint(root)),
	]
}

describe('one input added to the list — no kept result is reused', () => {
	it('reuses the metrics base, the hook bundles and the daemon while the toolchain is unchanged', () => {
		const kept = keep_all(project())

		expect(reused(kept)).toStrictEqual([true, true, true])
	})

	it.each(ADDED_INPUTS)('reuses none of them once %s is added', (added) => {
		const kept = keep_all(project())

		file(kept.root, added, JSON_BODY)

		expect(reused(kept)).toStrictEqual([false, false, false])
	})
})
