import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const make_directory = temporary_directory()
const BINARY_NAME = 'safe-chain-linuxstatic-x64'
const BINARY_CALLS = 'binary-calls'
const BINARY = `#!/bin/sh\necho "$1" >> "$RUNNER_TEMP/${BINARY_CALLS}"\n`
const CURL_CALLS = 'curl-calls'
const CURL_SETTINGS = 'curl-settings'
// Records each call and the config it ran with; serves the release JSON, then each asset into `-o`
// unless `$CURL_STATUS` fails the asset downloads.
const CURL = `#!/bin/sh
cat "$CURL_HOME/.curlrc" >> "$RUNNER_TEMP/${CURL_SETTINGS}"
echo "$*" >> "$RUNNER_TEMP/${CURL_CALLS}"
output=
url=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift ;;
    https://*) url=$1 ;;
  esac
  shift
done
case "$url" in
  */releases/tags/1.2.3) cat "$RUNNER_TEMP/release.json" ;;
  */releases/assets/*)
    [ "$CURL_STATUS" = 0 ] || exit "$CURL_STATUS"
    cp "$RUNNER_TEMP/release/\${url##*/}" "$output" ;;
  *) exit 22 ;;
esac
`
const GH_CALLS = 'gh-calls'
// The Playwright container carries no gh: any call is recorded and fails like a missing command.
const GH = `#!/bin/sh\necho "$*" >> "$RUNNER_TEMP/${GH_CALLS}"\nexit 127\n`
const TOKEN = 'job-token'
const API = 'https://api.github.com/repos/AikidoSec/safe-chain/releases'
const CURL_CONFIG = `retry = 3\nretry-delay = 2\nretry-max-time = 60\nheader = "Authorization: Bearer ${TOKEN}"\n`
const INSTALLER_NAME = 'install-safe-chain.sh'
const FETCH_CALLS = 3
const GITHUB_PATH_FILE = 'github-path'
const BINARY_DIRECTORY = path.join('.safe-chain', 'bin')
const DOWNLOADS = '.safe-chain-download'
const EXECUTABLE = 0o755
const FETCH_STEP = 'Fetch safe-chain'
const SETUP_STEP = 'Setup safe-chain'

function sha256(content: string): string {
	return createHash('sha256').update(content).digest('hex')
}

// The release installer bakes in the digest of each binary it fetches.
function installer(binary_digest: string): string {
	return `#!/bin/sh\nSHA256_LINUXSTATIC_X64="${binary_digest}"\nSHA256_MACOS_X64="${sha256('x')}"\n`
}

const INSTALLER = installer(sha256(BINARY))

function release_assets(): Array<{ name: string; url: string }> {
	return ['safe-chain-macos-arm64', INSTALLER_NAME, BINARY_NAME].map((name) => ({
		name,
		url: `${API}/assets/${name}`,
	}))
}

function setup(release_installer = INSTALLER): string {
	const directory = make_directory('safe-chain-download-')
	const release = path.join(directory, 'release')

	mkdirSync(release)
	writeFileSync(path.join(release, INSTALLER_NAME), release_installer)
	writeFileSync(path.join(release, BINARY_NAME), BINARY)
	writeFileSync(path.join(directory, 'release.json'), JSON.stringify({ assets: release_assets() }))
	writeFileSync(path.join(directory, 'curl'), CURL, { mode: EXECUTABLE })
	writeFileSync(path.join(directory, 'gh'), GH, { mode: EXECUTABLE })

	return directory
}

function run_step(name: string, directory: string, environment: Record<string, string>): number {
	const step = ci_yml_fixture
		.load_action(ci_yml_fixture.SETUP_PNPM_ACTION)
		.runs.steps.find((candidate) => candidate.name === name)

	const result = spawnSync('bash', ['-eo', 'pipefail', '-c', step?.run ?? 'exit 1'], {
		env: {
			...process.env,
			PATH: `${directory}:${process.env['PATH'] ?? ''}`,
			HOME: directory,
			GITHUB_PATH: path.join(directory, GITHUB_PATH_FILE),
			RUNNER_TEMP: directory,
			SAFE_CHAIN_BINARY: BINARY_NAME,
			...environment,
		},
	})

	return result.status ?? 1
}

function run_fetch(directory: string, curl_status = '0', binary = BINARY_NAME): number {
	return run_step(FETCH_STEP, directory, {
		GH_TOKEN: TOKEN,
		SAFE_CHAIN_INSTALLER_VERSION: '1.2.3',
		SAFE_CHAIN_BINARY: binary,
		CURL_STATUS: curl_status,
	})
}

function run_setup(directory: string, installer_digest = sha256(INSTALLER)): number {
	return run_step(SETUP_STEP, directory, { SAFE_CHAIN_INSTALLER_SHA256: installer_digest })
}

function curl_calls(directory: string): Array<string> {
	return readFileSync(path.join(directory, CURL_CALLS), 'utf8').trimEnd().split('\n')
}

function downloaded(directory: string, name: string): string {
	return readFileSync(path.join(directory, DOWNLOADS, name), 'utf8')
}

function setup_ran(directory: string): boolean {
	return existsSync(path.join(directory, BINARY_CALLS))
}

describe(FETCH_STEP, () => {
	it('downloads the pinned installer and this runner’s binary through the REST API', () => {
		const directory = setup()

		expect(run_fetch(directory)).toBe(0)
		expect(curl_calls(directory)).toEqual([
			`--proto =https -fsSL ${API}/tags/1.2.3`,
			...[INSTALLER_NAME, BINARY_NAME].map(
				(name) =>
					`--proto =https -fsSL -H Accept: application/octet-stream ${API}/assets/${name} -o ${path.join(directory, DOWNLOADS, name)}`,
			),
		])
		expect(downloaded(directory, INSTALLER_NAME)).toBe(INSTALLER)
		expect(downloaded(directory, BINARY_NAME)).toBe(BINARY)
	})

	// The Playwright container some jobs set pnpm up in carries no `gh`.
	it('never calls the gh CLI', () => {
		const directory = setup()

		run_fetch(directory)

		expect(existsSync(path.join(directory, GH_CALLS))).toBe(false)
	})

	it('sends the job token with bounded retries, then removes the config holding it', () => {
		const directory = setup()

		run_fetch(directory)

		expect(readFileSync(path.join(directory, CURL_SETTINGS), 'utf8')).toBe(
			CURL_CONFIG.repeat(FETCH_CALLS),
		)
		expect(readdirSync(directory).filter((name) => name.startsWith('safe-chain-curl.'))).toEqual([])
	})

	it('fails when the release has no asset for this runner', () => {
		expect(run_fetch(setup(), '0', 'safe-chain-plan9-x64')).not.toBe(0)
	})

	it('fails when an asset download still fails after curl’s retries', () => {
		expect(run_fetch(setup(), '22')).not.toBe(0)
	})
})

describe(SETUP_STEP, () => {
	// joshuafolkken/kit#2711: shims without a reachable binary let every install through without a scan.
	it('installs the verified binary, sets it up for CI and puts it on PATH', () => {
		const directory = setup()

		run_fetch(directory)

		expect(run_setup(directory)).toBe(0)
		expect(readFileSync(path.join(directory, BINARY_CALLS), 'utf8')).toBe('setup-ci\n')
		expect(readFileSync(path.join(directory, GITHUB_PATH_FILE), 'utf8')).toBe(
			`${path.join(directory, BINARY_DIRECTORY)}\n`,
		)
	})

	it('stops before setup-ci when the installer’s hash does not match the pin', () => {
		const directory = setup()

		run_fetch(directory)

		expect(run_setup(directory, sha256('different installer'))).not.toBe(0)
		expect(setup_ran(directory)).toBe(false)
	})

	it('stops before setup-ci when the binary does not match the installer’s digest', () => {
		const foreign = installer(sha256('different binary'))
		const directory = setup(foreign)

		run_fetch(directory)

		expect(run_setup(directory, sha256(foreign))).not.toBe(0)
		expect(setup_ran(directory)).toBe(false)
		expect(existsSync(path.join(directory, BINARY_DIRECTORY, 'safe-chain'))).toBe(false)
	})

	it('stops before setup-ci when the installer carries no digest for the binary', () => {
		const bare = '#!/bin/sh\n'
		const directory = setup(bare)

		run_fetch(directory)

		expect(run_setup(directory, sha256(bare))).not.toBe(0)
		expect(setup_ran(directory)).toBe(false)
	})
})
