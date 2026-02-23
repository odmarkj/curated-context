/**
 * Transcript JSONL where user makes design/architecture decisions
 * and assistant writes CSS, tailwind config, tsconfig via tool_use.
 */
export const TRANSCRIPT_DECISIONS = [
  JSON.stringify({
    type: 'user',
    uuid: 'u1',
    sessionId: 'test-sess-1',
    cwd: '/tmp/test-project',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: "Let's use Tailwind CSS with a blue-600 primary color and Inter font for the entire project." },
      ],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    sessionId: 'test-sess-1',
    cwd: '/tmp/test-project',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll set up Tailwind CSS with blue-600 as the primary color and Inter as the font." },
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'Write',
          input: {
            file_path: '/tmp/test-project/tailwind.config.js',
            content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./src/**/*.{js,ts,jsx,tsx}'],\n  theme: {\n    extend: {\n      colors: {\n        primary: '#2563eb',\n      },\n    },\n  },\n  plugins: [],\n};\n`,
          },
        },
        {
          type: 'tool_use',
          id: 'tu2',
          name: 'Write',
          input: {
            file_path: '/tmp/test-project/src/styles/globals.css',
            content: `:root {\n  --color-primary: #2563eb;\n  --color-secondary: #64748b;\n  --font-sans: 'Inter', sans-serif;\n}\n`,
          },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'u2',
    sessionId: 'test-sess-1',
    cwd: '/tmp/test-project',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: "We're using Next.js App Router with TypeScript. Always prefer server components." },
      ],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a2',
    sessionId: 'test-sess-1',
    cwd: '/tmp/test-project',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: "Understood. Going with Next.js App Router and server components as the default. Let me update the tsconfig." },
        {
          type: 'tool_use',
          id: 'tu3',
          name: 'Write',
          input: {
            file_path: '/tmp/test-project/tsconfig.json',
            content: '{"compilerOptions":{"target":"ES2022","module":"ESNext","jsx":"preserve","strict":true}}',
          },
        },
      ],
    },
  }),
].join('\n');

/**
 * Transcript JSONL with debugging/noise — should be filtered by triage.
 */
export const TRANSCRIPT_NOISE = [
  JSON.stringify({
    type: 'user',
    uuid: 'u1',
    sessionId: 'test-sess-noise',
    cwd: '/tmp/test-project',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Can you look at this error? I\'m getting a TypeError in the auth handler.' }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    sessionId: 'test-sess-noise',
    cwd: '/tmp/test-project',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Let me try reading the file to understand the error. Hmm, actually wait, let me search first.' }],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'u2',
    sessionId: 'test-sess-noise',
    cwd: '/tmp/test-project',
    message: {
      role: 'user',
      content: [{ type: 'text', text: "Maybe it's in the middleware? Not sure where exactly." }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a2',
    sessionId: 'test-sess-noise',
    cwd: '/tmp/test-project',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Let me try debugging this. I\'ll look at the error trace.' }],
    },
  }),
].join('\n');

/**
 * Transcript JSONL with queue-operation and file-history-snapshot lines that must be skipped.
 */
export const TRANSCRIPT_MIXED = [
  JSON.stringify({ type: 'queue-operation', data: { op: 'enqueue' } }),
  JSON.stringify({
    type: 'user',
    uuid: 'u1',
    sessionId: 'test-sess-mixed',
    cwd: '/tmp/test-project',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'We decided to use Drizzle ORM with PostgreSQL for the database layer.' }],
    },
  }),
  JSON.stringify({ type: 'file-history-snapshot', files: ['/tmp/test-project/src/db.ts'] }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    sessionId: 'test-sess-mixed',
    cwd: '/tmp/test-project',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll set up Drizzle ORM with PostgreSQL. Going with drizzle-kit for migrations." },
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'Write',
          input: {
            file_path: '/tmp/test-project/drizzle.config.ts',
            content: "import type { Config } from 'drizzle-kit';\nexport default { schema: './src/schema.ts', driver: 'pg' } satisfies Config;",
          },
        },
      ],
    },
  }),
].join('\n');

/**
 * Sample decisions.log content.
 */
export const DECISIONS_LOG = `[architecture] orm: Drizzle ORM with PostgreSQL
[design] primary-color: blue-600 (#2563eb)
[conventions] component-style: prefer server components in Next.js App Router
[tooling] test-runner: vitest with coverage
`;
