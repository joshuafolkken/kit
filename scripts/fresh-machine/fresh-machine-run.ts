import {
	appendFileSync,
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { execa, type Options } from 'execa'
import { z } from 'zod'
import { fresh_machine_docker, type ContainerRun } from './fresh-machine-docker'
import { fresh_machine_image } from './fresh-machine-image'
import { fresh_machine_log } from './fresh-machine-log'
import { fresh_machine_script } from './fresh-machine-script'
import type { Scenario } from './fresh-machine-spec'

// The I/O of `josh fresh:run`: build the machine, stage what the container may read, run the
// scenario, and put every line of all three into one log.

const DOCKER = 'docker'
const PNPM = 'pnpm'
const FAILURE_EXIT_CODE = 1
const STAGE_PREFIX = 'josh-fresh-machine-'
// The container's user is not the host's, so what it reads has to be readable by anyone — whatever
// the host's umask gave the seed files and the tarball `pnpm pack` wrote.
const SHARED_DIRECTORY_MODE = 0o755
const SHARED_FILE_MODE = 0o644
const TARBALL_EXTENSION = '.tgz'
const MANIFEST_SCHEMA = z.object({ name: z.string() })

interface RunRequest {
	scenario: Scenario
	run_name: string
	log_path: string
	package_version: string | undefined
	// Variable name → value, each passed into the container by name and replaced in every line.
	secrets: Readonly<Record<string, string>>
	is_rebuild: boolean
}

interface Stage {
	root: string
	seed_directory: string
	pack_directory: string
}

type Write = (line: string) => void

function logger(request: RunRequest): Write {
	const secrets = Object.values(request.secrets)

	return function write(line: string): void {
		const safe = fresh_machine_log.redact(line, secrets)

		console.info(safe)
		appendFileSync(request.log_path, `${safe}\n`)
	}
}

// One host command, its output streamed line by line into the log. A command that could not start
// (no docker on the machine) has no exit code, and its reason is the only line there is to log.
async function stream(
	file: string,
	arguments_: Array<string>,
	options: Options,
	write: Write,
): Promise<number> {
	const subprocess = execa(file, arguments_, { ...options, all: true, reject: false })
	const lines = subprocess.iterable({ from: 'all' })

	for await (const line of lines) write(String(line))

	const result = await subprocess

	if (result.exitCode === undefined) write(result.shortMessage ?? `${file} did not start`)

	return result.exitCode ?? FAILURE_EXIT_CODE
}

function staged_directory(root: string, name: string): string {
	const directory = path.join(root, name)

	mkdirSync(directory)

	return directory
}

function stage(scenario: Scenario): Stage {
	const root = mkdtempSync(path.join(os.tmpdir(), STAGE_PREFIX))
	const seed_directory = staged_directory(root, 'seed')

	for (const [file, content] of Object.entries(scenario.files)) {
		const target = path.join(seed_directory, file)

		mkdirSync(path.dirname(target), { recursive: true })
		writeFileSync(target, content)
	}

	return { root, seed_directory, pack_directory: staged_directory(root, 'pack') }
}

// Run once everything is staged, so the tarball is covered as well as the seed. The root itself stays
// as private as `mkdtemp` made it: a bind mount never enters a source through its parent, and on a
// shared host an open root would let every other user read the tarball for the length of the run.
function share(root: string): void {
	const entries = readdirSync(root, { withFileTypes: true, recursive: true })

	for (const entry of entries) {
		const mode = entry.isDirectory() ? SHARED_DIRECTORY_MODE : SHARED_FILE_MODE

		chmodSync(path.join(entry.parentPath, entry.name), mode)
	}
}

// `pnpm pack` runs the checkout's own `prepack`, so the tarball holds what a release of this tree
// would.
async function pack(pack_directory: string, write: Write): Promise<string> {
	const pack_arguments = ['pack', '--pack-destination', pack_directory]

	write(`$ ${PNPM} ${pack_arguments.join(' ')}`)
	await stream(PNPM, pack_arguments, { cwd: PROJECT_ROOT }, write)

	const tarball = readdirSync(pack_directory).find((file) => file.endsWith(TARBALL_EXTENSION))

	if (tarball === undefined) throw new Error('pnpm pack produced no tarball')

	return tarball
}

function package_name(): string {
	const manifest = readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')

	return MANIFEST_SCHEMA.parse(JSON.parse(manifest)).name
}

// The published version is always written out in the log and the install command, so a run can be
// repeated against the same release; without `--package-version` it is the registry's latest.
async function published_version(requested: string | undefined): Promise<string> {
	if (requested !== undefined) return requested

	const { stdout } = await execa(PNPM, ['view', package_name(), 'version'], { cwd: PROJECT_ROOT })

	return stdout.trim()
}

async function container_run(
	request: RunRequest,
	staged: Stage,
	write: Write,
): Promise<ContainerRun> {
	const { scenario } = request
	const is_tarball = scenario.package_source === 'tarball'

	return {
		image: fresh_machine_image.tag(scenario.requires_github),
		run_name: request.run_name,
		script: fresh_machine_script.build(scenario),
		seed_directory: staged.seed_directory,
		pack_directory: staged.pack_directory,
		tarball: is_tarball ? await pack(staged.pack_directory, write) : undefined,
		package_version: is_tarball ? undefined : await published_version(request.package_version),
		secret_names: Object.keys(request.secrets),
	}
}

async function build_image(request: RunRequest, write: Write): Promise<number> {
	const { scenario } = request
	const image = fresh_machine_image.tag(scenario.requires_github)
	const build_arguments = fresh_machine_docker.build_arguments(image, request.is_rebuild)
	const input = fresh_machine_image.dockerfile(scenario.requires_github)

	write(`$ ${DOCKER} ${build_arguments.join(' ')}`)

	return await stream(DOCKER, build_arguments, { input }, write)
}

async function run_container(request: RunRequest, staged: Stage, write: Write): Promise<number> {
	const container = await container_run(request, staged, write)

	share(staged.root)
	write(`$ ${DOCKER} run ${container.image} — ${request.run_name}`)
	write(`# package: ${container.tarball ?? container.package_version ?? ''}`)

	return await stream(
		DOCKER,
		fresh_machine_docker.run_arguments(container),
		{ env: request.secrets },
		write,
	)
}

async function run(request: RunRequest): Promise<number> {
	const write = logger(request)
	const build_code = await build_image(request, write)

	if (build_code !== 0) return build_code

	const staged = stage(request.scenario)

	try {
		return await run_container(request, staged, write)
	} finally {
		rmSync(staged.root, { recursive: true, force: true })
	}
}

const fresh_machine_run = { run }

export { fresh_machine_run }
export type { RunRequest }
