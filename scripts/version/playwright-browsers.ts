import { existsSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { execaSync } from 'execa'
import { z } from 'zod'

// A Playwright release drives one exact browser build, so a bumped `@playwright/test` cannot launch
// the browsers the previous version downloaded: every browser test fails with "Executable doesn't
// exist" until `playwright install` runs. `josh latest` is what moves the version, so it is also
// what has to leave the matching browsers behind — `josh adopt` runs the related tests right after
// it, with nobody in between to run the install by hand (joshuafolkken/kit#3675).

const INSTALLED_MANIFEST_PATH = path.join('node_modules', '@playwright', 'test', 'package.json')
const INSTALLED_MANIFEST_SCHEMA = z.object({ version: z.string() })
const BROWSERS_VARIABLE = 'JOSH_PLAYWRIGHT_BROWSERS'
// Leading letter required: a value starting with a dash would reach the command as an option.
const BROWSER_NAME_RE = /^[A-Za-z]/u
const FAILURE_EXIT_CODE = 1
const INSTALL_COMMAND: ReadonlyArray<string> = ['pnpm', 'exec', 'playwright', 'install']
const DRY_RUN_FLAG = '--dry-run'
const INSTALL_LOCATION_RE = /Install location: +(\S.*)/gu
// Written last by `playwright install`, so a directory an interrupted download left behind lacks it.
const COMPLETE_MARKER = 'INSTALLATION_COMPLETE'

// Chromium alone, as the CI fallback installs: a bare `playwright install` fetches chromium, firefox
// and webkit — roughly 1 GB — for the single chromium project kit scaffolds.
const DEFAULT_BROWSERS: ReadonlyArray<string> = ['chromium']

// The version actually installed, not the range in `package.json`: the browsers follow the resolved
// release, and a repository without the package answers `undefined` on both sides of the update.
function read_installed_version(): string | undefined {
	const content = file_reader.read_file_or_empty(INSTALLED_MANIFEST_PATH)

	return json_value.parse_with(content, INSTALLED_MANIFEST_SCHEMA)?.version
}

// The same variable name the CI workflow reads, sanitized the way its `tr -cd 'A-Za-z -'` does:
// everything but letters, dashes and the whitespace between names is stripped out of a name rather
// than the whole name dropped, so a mistyped `Chromium` or `chromium,firefox` reaches Playwright as
// an unknown browser and fails at the install — never silently narrowed to chromium, which would
// resurface later as a missing executable. A value with no usable name falls back to the default
// rather than to a bare install.
function resolve_browsers(environment: NodeJS.ProcessEnv = process.env): ReadonlyArray<string> {
	const value = (environment[BROWSERS_VARIABLE] ?? '').replaceAll(/[^A-Za-z\s-]/gu, '')
	const browsers = value.split(/\s+/u).filter((name) => BROWSER_NAME_RE.test(name))

	return browsers.length > 0 ? browsers : DEFAULT_BROWSERS
}

// A branded channel (`chrome`, `msedge`) reports `<system>` instead of a directory Playwright owns;
// there is nothing to look for, so it never counts as missing.
function is_downloaded(location: string): boolean {
	return !path.isAbsolute(location) || existsSync(path.join(location, COMPLETE_MARKER))
}

// Asks Playwright where the named browsers belong and whether each one is completely there. A
// version comparison alone cannot tell: an install that failed or was interrupted leaves the next
// run with the same version on both sides of the update and the browsers still absent, and that run
// has to retry it rather than finish as if nothing were missing. A plan Playwright refuses counts as
// missing, so the install runs and reports the refusal.
function has_missing_browser(browsers: ReadonlyArray<string>): boolean {
	const [cmd = '', ...rest] = [...INSTALL_COMMAND, DRY_RUN_FLAG, ...browsers]
	const plan = execaSync(cmd, rest, { reject: false })
	if (plan.exitCode !== 0) return true

	const locations = [...plan.stdout.matchAll(INSTALL_LOCATION_RE)].map(
		([, location = '']) => location,
	)

	return locations.some((location) => !is_downloaded(location))
}

function run_install(version: string, browsers: ReadonlyArray<string>): number {
	const command = [...INSTALL_COMMAND, ...browsers]
	const [cmd = '', ...rest] = command

	console.info(`\n▶ ${command.join(' ')} (browsers for @playwright/test ${version})`)

	const status = execaSync(cmd, rest, { stdio: 'inherit', reject: false }).exitCode
	if (status === 0) return 0

	console.error(
		`\n✖ Playwright browser install failed (${command.join(' ')} exited ${String(status)}); browser tests cannot run until it succeeds.`,
	)

	return FAILURE_EXIT_CODE
}

// `before` is the version read ahead of the update. A moved version always installs; an unmoved one
// installs only what an earlier run left missing, so a run that leaves Playwright alone with its
// browsers in place costs no download. Nothing runs when the package is absent.
function install_when_needed(before: string | undefined): number {
	const after = read_installed_version()
	if (after === undefined) return 0

	const browsers = resolve_browsers()
	if (after === before && !has_missing_browser(browsers)) return 0

	return run_install(after, browsers)
}

const playwright_browsers = {
	read_installed_version,
	resolve_browsers,
	install_when_needed,
}

export { playwright_browsers }
