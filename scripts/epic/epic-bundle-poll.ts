import { poll, type PollOptions } from '#scripts/lib/poll'

// **The open listing trails the create call**: `issue:file` asks
// `epic:bundle` about the issue it has just filed, and the list endpoint had not shown it yet on every
// filing of one run, so the placement was skipped each time. A caller that knows the issue is fresh
// passes a poll and the listing is read again until it shows the issue. An unreadable listing is
// final, since reading it again is not what would change it.

// A number typed at the command line names an issue that exists already, so it is read once.
const SINGLE_READ: PollOptions = { attempts: 1, interval_ms: 0 }

interface Listing {
	is_readable: boolean
	issues: ReadonlyArray<{ number: number }>
}

function is_settled(listing: Listing, issue_number: number): boolean {
	return !listing.is_readable || listing.issues.some((issue) => issue.number === issue_number)
}

async function read_until_listed<T extends Listing>(
	read: () => Promise<T>,
	issue_number: number,
	options: PollOptions = SINGLE_READ,
): Promise<T> {
	const reads: Array<T> = []

	await poll.poll_until(async () => {
		const listing = await read()

		reads.push(listing)

		return is_settled(listing, issue_number)
	}, options)

	return reads.at(-1) ?? (await read())
}

const epic_bundle_poll = { read_until_listed }

export { epic_bundle_poll }
