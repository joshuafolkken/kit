// Copy to src/hooks.server.ts in your SvelteKit project.
// Requires @sveltejs/kit to be installed in the consuming project.
// import type { Handle } from '@sveltejs/kit'

const SECURITY_HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	// Uncomment and configure Content-Security-Policy for your project:
	// 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const handle = async ({
	event,
	resolve,
}: {
	event: unknown
	resolve: (event: unknown) => Promise<Response>
}) => {
	const response = await resolve(event)

	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(header, value)
	}

	return response
}
