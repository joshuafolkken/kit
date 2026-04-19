# Agent Rules - 共通ルール

このプロジェクトで AI がコードを生成・変更する際に従うルールです。Cursor、Antigravity、CodeRabbit など、各種 AI ツールから参照されます。

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, sveltekit-adapter, devtools-json, drizzle, better-auth, paraglide, mcp

## Coding Standards

- **Prompt Reference**: When generating or modifying any code, ALWAYS read and follow the instructions in `prompts/coding-standards.md` before starting.
- This project uses non-standard conventions (e.g., `snake_case` for variables/functions, namespace object exports). Ensure all generated code complies.

## Code Change Rules

Whenever modifying, adding, or deleting any code:

1. **Refactor First**: Before submitting, apply refactoring (high and medium priority) to all newly written or modified code. Follow the instructions in `prompts/refactoring.md`.
2. **Verify Type Safety**: Run `pnpm run check`.
3. **Verify Style and Quality**: Run `pnpm run lint`.
4. **Verify IDE Feedback**: ALWAYS review the "IDE feedback" provided in the prompt for any remaining lint errors. This is usually more up-to-date than terminal commands.
5. **Fix Issues**: If any check fails (terminal or IDE feedback), fix all reported issues immediately.
6. **Repeat**: Repeat the checks until they pass.
7. **Completion**: Only finish the task or response after ALL checks pass.

**Constraint**: Never state "it should pass" without actually having run the commands and confirmed the output. Do not end a task while errors exist. If verification commands fail (e.g., system error), you MUST rely on IDE feedback to ensure correctness.

## Refactoring Rules

- **Prompt Reference**: When performing any refactoring, ALWAYS read and follow the instructions in `prompts/refactoring.md` before starting.

## Git Rules

- **No Commits**: DO NOT commit changes unless explicitly requested by the user.
- **Workflow Awareness**: Use `scripts/git-workflow.ts` (via `pnpm josh git`) when the user asks for git operations.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
