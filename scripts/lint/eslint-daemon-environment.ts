import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { untyped_environment } from '#eslint/untyped-environment.js'
import { eslint_heap } from './eslint-heap'

// `eslint_d` 15.1 keys a daemon on its forwarder's cwd, `--config` and whole environment: the record
// beside the eslint it resolves is `.eslint_d-<sha256(JSON [cwd, config, environment hash])>`
// (`eslint_d/lib/config.js` → `configFile`, `lib/hash.js` → `environmentHash`), and the daemon it
// launches inherits that environment. A caller passing its own environment — the edit hook under the
// agent, `josh lint:related` under pnpm — reaches a daemon of its own, so a checkout kept two or three
// resident (joshuafolkken/kit#8848). Every kit launch of `eslint_d` passes this one environment, built
// from nothing the caller varies, so every caller reaches the same daemon.
// The record name is computed here rather than imported: `eslint_d` is kit's dev dependency, which a
// consumer need not resolve. `eslint-daemon-environment.test.ts` runs `eslint_d`'s own resolver under
// this environment, so a format change fails there.

const RECORD_PREFIX = '.eslint_d-'
const RECORD_NAME = /^\.eslint_d-[\da-f]{64}$/u
const DIGEST_ALGORITHM = 'sha256'
// What `environmentHash` leaves out: DEBUG is forwarded per request, and pnpm puts a command's
// arguments in `npm_lifecycle_script`.
const NOT_HASHED: ReadonlySet<string> = new Set(['DEBUG', 'npm_lifecycle_script'])
// kit passes no `--config` to the daemon, which `eslint_d` reads as an empty config path.
const NO_ESLINT_CONFIG = ''
// The caller variables passed on: the same for every process of one user's checkout. macOS adds
// `__CF_USER_TEXT_ENCODING` to a process environment that lacks it, so the forwarder would hash a
// variable kit left out; passing the caller's value keeps the two hashes one.
const INHERITED: ReadonlyArray<string> = ['HOME', '__CF_USER_TEXT_ENCODING']
// The node running kit, then the system tools a rule or plugin may spawn — never the caller's PATH,
// which pnpm prefixes with the project's `.bin` directories.
const SYSTEM_PATH: ReadonlyArray<string> = ['/usr/bin', '/bin']

function digest_of(text: string): string {
	return createHash(DIGEST_ALGORITHM).update(text).digest('hex')
}

function inherited(): NodeJS.ProcessEnv {
	const variables: NodeJS.ProcessEnv = {}

	for (const name of INHERITED) {
		const value = process.env[name]
		if (value !== undefined) variables[name] = value
	}

	return variables
}

// No `FORCE_COLOR`, which differs between a buffered caller and the edit hook: the forwarder reads
// its color level from its own pipe, so a daemon report is plain. The heap is the only `NODE_OPTIONS`.
function environment(): NodeJS.ProcessEnv {
	return {
		...inherited(),
		PATH: [path.dirname(process.execPath), ...SYSTEM_PATH].join(path.delimiter),
		NODE_OPTIONS: eslint_heap.with_heap(undefined),
		ESLINT_D_MISS: 'fail',
		...untyped_environment.environment(),
	}
}

function by_code_unit(left: string, right: string): number {
	return left < right ? -1 : 1
}

function environment_hash(variables: NodeJS.ProcessEnv): string {
	const entries = Object.keys(variables)
		.toSorted(by_code_unit)
		.filter((name) => !NOT_HASHED.has(name) && variables[name] !== undefined)
		.map((name) => [name, variables[name]])

	return digest_of(JSON.stringify(entries))
}

// The forwarder's cwd is the physical directory it runs in, so a symlinked root is resolved first.
function record_file(eslint_directory: string, project_root: string): string {
	const key = JSON.stringify([
		realpathSync(project_root),
		NO_ESLINT_CONFIG,
		environment_hash(environment()),
	])

	return `${eslint_directory}/${RECORD_PREFIX}${digest_of(key)}`
}

// A daemon's record, as against kit's own records beside it (`.eslint_d-toolchain`, `.eslint_d-calls`).
function is_record_name(name: string): boolean {
	return RECORD_NAME.test(name)
}

const eslint_daemon_environment = { environment, is_record_name, record_file }

export { eslint_daemon_environment }
