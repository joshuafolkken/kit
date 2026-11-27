import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { josh_in_process } from '#scripts/josh/josh-in-process'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { NOTHING_TO_CHECK_MARKER } from '#scripts/test/skip-marker'
import type { ReportedMember } from '#tools/exports/unused-members-cache'

const CHECK = 'exports'
const FAIL_EXIT_CODE = 1
const CLI = 'unused-members-cli.ts'
// A bundle keeps its source's `import.meta.url` (`scripts/build/source-location.ts`), so both paths
// name this package's files whether this module runs from source or from `dist`.
const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIRECTORY = path.join(SOURCE_DIRECTORY, '..', '..')
const CLI_SOURCE = path.join(SOURCE_DIRECTORY, CLI)
// The CLI's build output, `<package>/dist/commands/unused-members-cli.js`.
const CLI_BUNDLE = josh_in_process.bundled_script_path(PACKAGE_DIRECTORY, CLI)
// A consumer's namespaces are read from `.svelte` files and routes a TypeScript program over its
// `tsconfig.json` does not see, so every member they use would read as unused. The check is kit's own.
//
// **Not a skip notice**. `SKIP_MARKER` means "a check passed without running",
// and the gate withholds its green record on it — so a consumer, where this notice prints on every
// run, never got a green record. Out of scope by design is not unverified, so the marker stays out.
const CONSUMER_NOTICE = `josh ${CHECK}: checks only the kit repository itself — ${NOTHING_TO_CHECK_MARKER} in a consumer project.`

function format_member(root: string, member: ReportedMember): string {
	return `${path.relative(root, member.file)}:${String(member.line)}  ${member.namespace}.${member.member}`
}

function report(root: string, members: ReadonlyArray<ReportedMember>): string {
	if (members.length === 0) return `josh ${CHECK}: no unused namespace member`

	return [
		`josh ${CHECK}: ${String(members.length)} namespace member(s) nothing reads — remove each from its namespace object (and the declaration, if nothing in its file uses it either):`,
		...members.map((member) => `  ${format_member(root, member)}`),
	].join('\n')
}

// Loaded only past the consumer skip: the scanner pulls in `typescript`, an optional peer a
// basic-profile consumer may not have, and this check runs in every consumer's gate. For the same
// reason the scanner is left out of the published package (`package.json` `files`); only this check
// ships. `files` narrows the scan to the namespaces they declare or import directly; undefined scans
// the whole program.
async function find_members(
	root: string,
	files: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<ReportedMember>> {
	const { unused_members } = await import('#tools/exports/unused-members')
	if (files === undefined) return unused_members.find_unused_members(root)

	return await unused_members.find_unused_members_in(root, files)
}

async function run_unused_members(root: string, files?: ReadonlyArray<string>): Promise<number> {
	if (doctor_consumer.is_kit_consumer(root)) {
		console.info(CONSUMER_NOTICE)

		return 0
	}

	const members = await find_members(root, files)
	const output = report(root, members)

	if (members.length === 0) console.info(output)
	else console.error(output)

	return members.length === 0 ? 0 : FAIL_EXIT_CODE
}

interface UnusedMembersRun {
	exit_code: number
	output: string
}

// The CLI's guard past its source path: the node child started on its bundle.
function is_bundle_entry(script: string | undefined): boolean {
	return script === CLI_BUNDLE
}

// The built bundle under node, so the child does not transform the CLI and its imports on every
// start. `dist` the dispatcher could not rebuild (`tools/josh/josh-ready.ts`) is stale, and running it
// would check with code the source already replaced: then the source runs under tsx, as the
// dispatcher itself does.
async function launch_child(
	root: string,
	files: ReadonlyArray<string>,
): Promise<BufferedProcessResult> {
	const options = { cwd: root }

	if (!hook_bundle_stamp.is_fresh(path.dirname(CLI_BUNDLE), PACKAGE_DIRECTORY)) {
		return await buffered_process.run_buffered_direct(
			['exec', 'tsx', CLI_SOURCE, ...files],
			options,
		)
	}

	const launch = { file: process.execPath, args: [CLI_BUNDLE, ...files] }

	return await buffered_process.run_buffered_launch(launch, options)
}

// The child runs the CLI, not `josh exports:unused`, which would claim the cores the in-process
// check never did. No file list scans the whole program, as the CLI does with no argument. The CLI
// is resolved from this package, not the root: the root under check need not be kit.
async function run_child(root: string, files: ReadonlyArray<string>): Promise<UnusedMembersRun> {
	const result = await launch_child(root, files)

	return { exit_code: result.exit_code ?? FAIL_EXIT_CODE, output: result.output }
}

// The check in a child process, its report held back: `josh lint:related` starts it beside its lint,
// where the scan's synchronous seconds in process would hold back the lint's own spawns
// (joshuafolkken/kit#7829). A consumer gets the notice and an empty narrowed list the empty report,
// as in process, without a child.
async function spawn_unused_members(
	root: string,
	files?: ReadonlyArray<string>,
): Promise<UnusedMembersRun> {
	if (doctor_consumer.is_kit_consumer(root)) return { exit_code: 0, output: CONSUMER_NOTICE }
	if (files === undefined) return await run_child(root, [])
	if (files.length === 0) return { exit_code: 0, output: report(root, []) }

	return await run_child(root, files)
}

const unused_members_check = {
	is_bundle_entry,
	run_unused_members,
	spawn_unused_members,
	CONSUMER_NOTICE,
}

export { unused_members_check }
