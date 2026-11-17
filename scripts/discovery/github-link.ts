import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { repo_discovery } from './repo-discovery'
import { repo_origin } from './repo-origin'

// Whether this repository is linked to GitHub: `gh` on PATH, `gh` signed in, and `origin` on GitHub.
// Local state only — no process and no network — so a per-turn hook can afford it: PATH is scanned
// rather than `gh --version` run, and sign-in is read from a token variable's presence or a
// `github.com` entry in gh's hosts.yml rather than `gh auth status`, which calls the API. No
// credential value leaves this module; every answer is a boolean.

const GH_BINARY_NAMES = ['gh', 'gh.exe']
const TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'] as const
const HOSTS_FILE = 'hosts.yml'
const HOSTS_ENTRY = `${repo_origin.GITHUB_HOST}:`

type EnvironmentKey =
	'PATH' | 'GH_TOKEN' | 'GITHUB_TOKEN' | 'GH_CONFIG_DIR' | 'XDG_CONFIG_HOME' | 'APPDATA' | 'HOME'
type Environment = Readonly<Partial<Record<EnvironmentKey, string>>>

function is_present(value: string | undefined): value is string {
	return value !== undefined && value !== ''
}

function has_gh(environment: Environment = process.env): boolean {
	const directories = (environment.PATH ?? '').split(path.delimiter).filter(is_present)

	return directories.some((directory) =>
		GH_BINARY_NAMES.some((name) => existsSync(path.join(directory, name))),
	)
}

// The directory gh itself resolves, in its order: GH_CONFIG_DIR, XDG_CONFIG_HOME, AppData, HOME.
function gh_config_directory(environment: Environment): string | undefined {
	if (is_present(environment.GH_CONFIG_DIR)) return environment.GH_CONFIG_DIR
	if (is_present(environment.XDG_CONFIG_HOME)) return path.join(environment.XDG_CONFIG_HOME, 'gh')
	if (is_present(environment.APPDATA)) return path.join(environment.APPDATA, 'GitHub CLI')

	return is_present(environment.HOME) ? path.join(environment.HOME, '.config', 'gh') : undefined
}

function read_hosts(environment: Environment): string {
	const directory = gh_config_directory(environment)

	if (directory === undefined) return ''

	try {
		return readFileSync(path.join(directory, HOSTS_FILE), 'utf8')
	} catch {
		return ''
	}
}

function is_signed_in(environment: Environment = process.env): boolean {
	if (TOKEN_ENV_KEYS.some((key) => is_present(environment[key]))) return true

	return read_hosts(environment)
		.split('\n')
		.some((line) => line.trimEnd() === HOSTS_ENTRY)
}

function is_origin_on_github(repository_path: string = process.cwd()): boolean {
	const url = repo_discovery.read_origin_url(repository_path)

	return url !== undefined && repo_origin.parse_origin_url(url) !== undefined
}

function is_linked(
	repository_path: string = process.cwd(),
	environment: Environment = process.env,
): boolean {
	return has_gh(environment) && is_signed_in(environment) && is_origin_on_github(repository_path)
}

const github_link = { is_signed_in, is_linked }

export { github_link }
