import path from 'node:path'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { NOTHING_TO_CHECK_MARKER } from '#scripts/test/skip-marker'
import type { NamespaceMember } from '#tools/exports/namespace-members'

const CHECK = 'exports'
const FAIL_EXIT_CODE = 1
// A consumer's namespaces are read from `.svelte` files and routes a TypeScript program over its
// `tsconfig.json` does not see, so every member they use would read as unused. The check is kit's own.
//
// **Not a skip notice**. `SKIP_MARKER` means "a check passed without running",
// and the gate withholds its green record on it — so a consumer, where this notice prints on every
// run, never got a green record. Out of scope by design is not unverified, so the marker stays out.
const CONSUMER_NOTICE = `josh ${CHECK}: checks only the kit repository itself — ${NOTHING_TO_CHECK_MARKER} in a consumer project.`

function format_member(root: string, member: NamespaceMember): string {
	return `${path.relative(root, member.file)}:${String(member.line)}  ${member.namespace}.${member.member}`
}

function report(root: string, members: ReadonlyArray<NamespaceMember>): string {
	if (members.length === 0) return `josh ${CHECK}: no unused namespace member`

	return [
		`josh ${CHECK}: ${String(members.length)} namespace member(s) nothing reads — remove each from its namespace object (and the declaration, if nothing in its file uses it either):`,
		...members.map((member) => `  ${format_member(root, member)}`),
	].join('\n')
}

// Loaded only past the consumer skip: the scanner pulls in `typescript`, an optional peer a
// basic-profile consumer may not have, and this check runs in every consumer's gate. For the same
// reason the scanner is left out of the published package (`package.json` `files`); only this check
// ships. `files` narrows the scan to the namespaces they declare; undefined scans the whole program.
async function find_members(
	root: string,
	files: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<NamespaceMember>> {
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

const unused_members_check = { run_unused_members, CONSUMER_NOTICE }

export { unused_members_check }
