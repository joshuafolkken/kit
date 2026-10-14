import { fresh_machine_script } from './fresh-machine-script'

// The two docker invocations of `josh fresh:run`, as argument lists. A secret is passed by name
// only (`--env GH_TOKEN`): docker reads its value from the environment of the client, so it is in no
// argument, no image layer and no printed command.

const TOKEN_VARIABLE = 'GH_TOKEN'
const ENV_FLAG = '--env'
const VOLUME_FLAG = '--volume'

interface ContainerRun {
	image: string
	run_name: string
	script: string
	seed_directory: string
	pack_directory: string
	// The packed checkout's file name inside `pack_directory`, for a tarball scenario.
	tarball: string | undefined
	package_version: string | undefined
	// The variables whose values the `docker run` client's environment carries.
	secret_names: ReadonlyArray<string>
}

// The Dockerfile arrives on stdin (`-`), so the build has no context to copy a host file from.
function build_arguments(image: string, is_rebuild: boolean): Array<string> {
	const cache = is_rebuild ? ['--no-cache'] : []

	return ['build', '--progress', 'plain', ...cache, '--tag', image, '-']
}

function variables(container: ContainerRun): Array<string> {
	const { tarball } = container
	const tarball_path = tarball === undefined ? '' : `${fresh_machine_script.PACK_MOUNT}/${tarball}`
	const assignments = [
		`RUN_NAME=${container.run_name}`,
		`PACKAGE_TARBALL=${tarball_path}`,
		`PACKAGE_VERSION=${container.package_version ?? ''}`,
		...container.secret_names,
	]

	return assignments.flatMap((assignment) => [ENV_FLAG, assignment])
}

// `bash -i` is the new terminal the prerequisites guide asks for: it reads the profile the pnpm
// installer edited, which a non-interactive shell on Debian returns from before reaching.
function run_arguments(container: ContainerRun): Array<string> {
	return [
		'run',
		'--rm',
		...variables(container),
		VOLUME_FLAG,
		`${container.seed_directory}:${fresh_machine_script.SEED_MOUNT}:ro`,
		VOLUME_FLAG,
		`${container.pack_directory}:${fresh_machine_script.PACK_MOUNT}:ro`,
		container.image,
		'bash',
		'-ic',
		container.script,
	]
}

const fresh_machine_docker = { build_arguments, run_arguments, TOKEN_VARIABLE }

export { fresh_machine_docker }
export type { ContainerRun }
