import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const make_directory = temporary_directory()
const BINARY_NAME = 'safe-chain-linuxstatic-x64'
const BINARY_CALLS = 'binary-calls'
const BINARY = `#!/bin/sh\necho "$1" >> "$RUNNER_TEMP/${BINARY_CALLS}"\n`
const GH_CALLS = 'gh-calls'
// Records each call, fails the first `$GH_FAILURES` of them, then copies the release into `--dir`.
const GH = `#!/bin/sh
echo "$*" >> "$RUNNER_TEMP/${GH_CALLS}"
[ "$(wc -l < "$RUNNER_TEMP/${GH_CALLS}")" -gt "$GH_FAILURES" ] || exit 1
while [ "$1" != --dir ]; do shift; done
mkdir -p "$2"
cp "$RUNNER_TEMP/release/"* "$2"
`
const GITHUB_PATH_FILE = 'github-path'
const BINARY_DIRECTORY = path.join('.safe-chain', 'bin')
const DOWNLOADS = '.safe-chain-download'
const EXECUTABLE = 0o755
const ATTEMPTS = 3
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

function setup(release_installer = INSTALLER): string {
	const directory = make_directory('safe-chain-download-')
	const release = path.join(directory, 'release')

	mkdirSync(release)
	writeFileSync(path.join(release, 'install-safe-chain.sh'), release_installer)
	writeFileSync(path.join(release, BINARY_NAME), BINARY)
	writeFileSync(path.join(directory, 'gh'), GH, { mode: EXECUTABLE })
	writeFileSync(path.join(directory, 'sleep'), '#!/bin/sh\n', { mode: EXECUTABLE })

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

function run_fetch(directory: string, failures = 0): number {
	return run_step(FETCH_STEP, directory, {
		SAFE_CHAIN_INSTALLER_VERSION: '1.2.3',
		GH_FAILURES: String(failures),
	})
}

function run_setup(directory: string, installer_digest = sha256(INSTALLER)): number {
	return run_step(SETUP_STEP, directory, { SAFE_CHAIN_INSTALLER_SHA256: installer_digest })
}

function gh_calls(directory: string): Array<string> {
	return readFileSync(path.join(directory, GH_CALLS), 'utf8').trimEnd().split('\n')
}

function setup_ran(directory: string): boolean {
	return existsSync(path.join(directory, BINARY_CALLS))
}

describe(FETCH_STEP, () => {
	it('downloads the pinned installer and this runner’s binary from the release', () => {
		const directory = setup()

		expect(run_fetch(directory)).toBe(0)
		expect(gh_calls(directory)).toEqual([
			`release download 1.2.3 --repo AikidoSec/safe-chain --pattern install-safe-chain.sh --pattern ${BINARY_NAME} --dir ${path.join(directory, DOWNLOADS)} --clobber`,
		])
	})

	it('retries a failed download and succeeds on a later attempt', () => {
		const directory = setup()

		expect(run_fetch(directory, ATTEMPTS - 1)).toBe(0)
		expect(gh_calls(directory)).toHaveLength(ATTEMPTS)
	})

	it('fails after a bounded number of attempts', () => {
		const directory = setup()

		expect(run_fetch(directory, ATTEMPTS)).not.toBe(0)
		expect(gh_calls(directory)).toHaveLength(ATTEMPTS)
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
