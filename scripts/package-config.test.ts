import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
	pnpm?: {
		overrides?: Record<string, string>
		// eslint-disable-next-line @typescript-eslint/naming-convention
		onlyBuiltDependencies?: Array<string>
	}
	scripts?: Record<string, string>
}

function load_manifest(): PackageJson {
	const content = readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')

	return JSON.parse(content) as PackageJson
}

describe('package.json pnpm.overrides', () => {
	const manifest = load_manifest()
	const overrides = manifest.pnpm?.overrides ?? {}

	it('pins eslint-plugin-promise to a safe floor', () => {
		expect(overrides['eslint-plugin-promise']).toBe('^7.2.1')
	})
})

describe('package.json pnpm built-dependency lists', () => {
	const manifest = load_manifest()
	const only_built = manifest.pnpm?.onlyBuiltDependencies ?? []

	it('keeps native builds required by this project', () => {
		expect(only_built).toEqual(expect.arrayContaining(['esbuild', 'lefthook', 'unrs-resolver']))
	})
})

describe('package.json scripts', () => {
	const manifest = load_manifest()
	const scripts = manifest.scripts ?? {}

	it('exposes the security audit command', () => {
		expect(scripts['audit:security']).toBe('tsx scripts/security-audit.ts')
	})

	it('does not use redundant pnpm run prefix in scripts', () => {
		const has_pnpm_run = Object.values(scripts).some((cmd) => /pnpm run [a-z]/u.test(cmd))

		expect(has_pnpm_run).toBe(false)
	})
})
