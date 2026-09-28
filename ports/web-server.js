// The command Playwright's `webServer` runs, built so no package manager stands between Playwright
// and the server it starts.
//
// Playwright spawns the command detached and tears it down by signalling that process group. pnpm
// 11.27.1+ moves a script it runs without a controlling terminal into a group of its own, so the
// teardown reached pnpm alone and the dev / preview server survived holding Playwright's stdio pipes
// open — a hang #2386 patched by relying on pnpm to relay SIGTERM. `node --run` executes the same
// `package.json` script in the caller's process group, so the teardown signal reaches the server
// itself and there is no relay left to depend on (#2392).
//
// The script names stay the interface rather than a hard-coded `vite` invocation: a consumer's
// `preview` is not necessarily `vite preview` (wrangler serves the Cloudflare build), and each script
// resolves its own port through `josh port`. What `node --run` does not do is run `pre<name>` hooks,
// which a consumer can rely on — a `prepreview` applying local database migrations, say — so the hook
// is chained explicitly here instead of being dropped without a word. `post<name>` is not: a server
// script never ends on its own, so its post hook would never have run under pnpm either.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ports } from './index.js'

const PACKAGE_FILE_NAME = 'package.json'
const PRE_HOOK_PREFIX = 'pre'
const STEP_SEPARATOR = ' && '

/**
 * The `scripts` of the project root's `package.json` — the same file `node --run` resolves from the
 * working directory — or an empty record when there is none.
 *
 * @param {string} directory
 * @returns {Record<string, unknown>}
 */
function read_scripts(directory) {
	const file = path.join(ports.resolve_project_directory(directory), PACKAGE_FILE_NAME)
	if (!existsSync(file)) return {}

	const { scripts } = JSON.parse(readFileSync(file, 'utf8'))

	return typeof scripts === 'object' && scripts !== null ? scripts : {}
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} scripts
 * @returns {string[]}
 */
function steps_for(name, scripts) {
	const hook = `${PRE_HOOK_PREFIX}${name}`

	return Object.hasOwn(scripts, hook) ? [hook, name] : [name]
}

/**
 * Chain the named `package.json` scripts, each preceded by its `pre` hook when the project defines
 * one, into a single shell command run through `node --run`.
 *
 * @param {string[]} names
 * @param {string} [directory]
 * @returns {string}
 */
function script_command(names, directory = process.cwd()) {
	const scripts = read_scripts(directory)

	return names
		.flatMap((name) => steps_for(name, scripts))
		.map((step) => `node --run ${step}`)
		.join(STEP_SEPARATOR)
}

const web_server = {
	script_command,
}

export { web_server }
