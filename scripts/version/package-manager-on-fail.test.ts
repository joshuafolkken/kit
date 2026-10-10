import { describe, expect, it } from 'vitest'
import { package_manager_version } from './package-manager-version'

function manifest(package_manager_on_fail: string, runtime_on_fail = 'error'): string {
	return `{\n\t"packageManager": "pnpm@12.6.0",\n\t"devEngines": {\n\t\t"runtime": {\n\t\t\t"name": "node",\n\t\t\t"onFail": "${runtime_on_fail}"\n\t\t},\n\t\t"packageManager": {\n\t\t\t"name": "pnpm",\n\t\t\t"version": "12.6.0",\n\t\t\t"onFail": "${package_manager_on_fail}"\n\t\t}\n\t}\n}\n`
}

const { upgrade_development_engines_on_fail } = package_manager_version

// joshuafolkken/kit#3388: `onFail: "error"` leaves a standalone pnpm of another version unable to run.
describe('upgrade_development_engines_on_fail', () => {
	it('rewrites only the packageManager onFail, leaving the runtime onFail and the rest byte-for-byte', () => {
		expect(upgrade_development_engines_on_fail(manifest('error'))).toBe(manifest('download'))
	})

	it.each(['warn', 'ignore', 'download'])('keeps an onFail of %s the project chose', (on_fail) => {
		expect(upgrade_development_engines_on_fail(manifest(on_fail))).toBe(manifest(on_fail))
	})

	it('leaves a manifest without devEngines unchanged', () => {
		const content = '{\n\t"name": "demo",\n\t"packageManager": "pnpm@12.6.0"\n}\n'

		expect(upgrade_development_engines_on_fail(content)).toBe(content)
	})
})
