import { describe, it, expect } from 'vitest';
import { extractStructural } from '../../../src/extraction/structural.js';
import type { ToolEvent } from '../../../src/extraction/transcript.js';

describe('extractStructural', () => {
  it('extracts CSS variables from .css file writes', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/src/styles/globals.css',
          content: ':root {\n  --color-primary: #2563eb;\n  --color-secondary: #64748b;\n}',
        },
      },
    ];
    const result = extractStructural(events);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const cssVars = result.find((m) => m.key.startsWith('css-variables'));
    expect(cssVars).toBeDefined();
    expect(cssVars!.category).toBe('design');
    expect(cssVars!.value).toContain('--color-primary: #2563eb');
  });

  it('extracts Tailwind theme colors', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/tailwind.config.js',
          content: "colors: { primary: '#2563eb' }",
        },
      },
    ];
    const result = extractStructural(events);
    const theme = result.find((m) => m.key.startsWith('theme-colors') || m.key.startsWith('config'));
    expect(theme).toBeDefined();
  });

  it('extracts dependencies from package.json writes', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/package.json',
          content: JSON.stringify({
            dependencies: { react: '^18.0.0', next: '^14.0.0' },
            devDependencies: { typescript: '^5.0.0' },
          }),
        },
      },
    ];
    const result = extractStructural(events);
    const deps = result.find((m) => m.key === 'dependencies');
    expect(deps).toBeDefined();
    expect(deps!.category).toBe('architecture');
    expect(deps!.value).toContain('react@^18.0.0');

    const devDeps = result.find((m) => m.key === 'dev-dependencies');
    expect(devDeps).toBeDefined();
    expect(devDeps!.category).toBe('tooling');
  });

  it('extracts config decisions from tsconfig.json', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/tsconfig.json',
          content: JSON.stringify({
            compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
          }),
        },
      },
    ];
    const result = extractStructural(events);
    const config = result.find((m) => m.key.includes('tsconfig'));
    expect(config).toBeDefined();
    expect(config!.category).toBe('config');
    expect(config!.value).toContain('target: ES2022');
  });

  it('extracts route definitions from api files', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/src/api/routes.ts',
          content: `app.get('/users', handler);\napp.post('/users', createHandler);`,
        },
      },
    ];
    const result = extractStructural(events);
    const routes = result.find((m) => m.key.startsWith('routes'));
    expect(routes).toBeDefined();
    expect(routes!.category).toBe('api');
    expect(routes!.value).toContain('GET /users');
  });

  it('deduplicates by key (highest confidence wins)', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/src/styles/a.css',
          content: ':root { --color-primary: #111; }',
        },
      },
      {
        tool: 'Write',
        input: {
          file_path: '/project/src/styles/a.css',
          content: ':root { --color-primary: #222; }',
        },
      },
    ];
    const result = extractStructural(events);
    const cssKeys = result.filter((m) => m.key === 'css-variables-a.css');
    expect(cssKeys).toHaveLength(1);
  });

  it('Read/Glob events do not produce css/config/route memories', () => {
    const events: ToolEvent[] = [
      { tool: 'Read', input: { file_path: '/project/src/styles/globals.css' } },
      { tool: 'Glob', input: { pattern: '**/*.css' } },
    ];
    const result = extractStructural(events);
    // No design/config/api memories from Read/Glob
    const nonData = result.filter((m) => m.category !== 'data');
    expect(nonData).toHaveLength(0);
  });

  it('ignores Write events with empty content', () => {
    const events: ToolEvent[] = [
      { tool: 'Write', input: { file_path: '/project/src/styles/globals.css', content: '' } },
    ];
    const result = extractStructural(events);
    expect(result).toHaveLength(0);
  });

  // === Data file detection ===

  it('extracts data files from Read tool events', () => {
    const events: ToolEvent[] = [
      { tool: 'Read', input: { file_path: '/project/data/chocolate_bars.jsonl' } },
    ];
    const result = extractStructural(events);
    const dataFile = result.find((m) => m.key === 'data-file-chocolate_bars.jsonl');
    expect(dataFile).toBeDefined();
    expect(dataFile!.category).toBe('data');
    expect(dataFile!.confidence).toBe(0.85);
    expect(dataFile!.value).toContain('JSONL');
  });

  it('extracts data files from Write events with schema sniffing', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/data/bars.jsonl',
          content: '{"name":"Dark Chocolate","origin":"Peru","rating":4.5}\n{"name":"Milk","origin":"Ghana","rating":3.8}',
        },
      },
    ];
    const result = extractStructural(events);
    const dataFile = result.find((m) => m.key === 'data-file-bars.jsonl');
    expect(dataFile).toBeDefined();
    expect(dataFile!.confidence).toBe(0.95);
    expect(dataFile!.value).toContain('fields: name, origin, rating');
  });

  it('sniffs CSV headers from first line', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/data/export.csv',
          content: 'name,origin,cacao_pct,rating\nDark,Peru,70,4.5',
        },
      },
    ];
    const result = extractStructural(events);
    const dataFile = result.find((m) => m.key === 'data-file-export.csv');
    expect(dataFile).toBeDefined();
    expect(dataFile!.value).toContain('fields: name, origin, cacao_pct, rating');
  });

  it('extracts data files from Bash commands', () => {
    const events: ToolEvent[] = [
      { tool: 'Bash', input: { command: 'head -5 /project/data/output.parquet' } },
    ];
    const result = extractStructural(events);
    const dataFile = result.find((m) => m.key === 'data-file-output.parquet');
    expect(dataFile).toBeDefined();
    expect(dataFile!.confidence).toBe(0.75);
  });

  it('detects canonical sources referenced 3+ times', () => {
    const events: ToolEvent[] = [
      { tool: 'Read', input: { file_path: '/project/data/bars.jsonl' } },
      { tool: 'Read', input: { file_path: '/project/data/bars.jsonl' } },
      { tool: 'Read', input: { file_path: '/project/data/bars.jsonl' } },
    ];
    const result = extractStructural(events);
    const canonical = result.find((m) => m.key === 'canonical-bars.jsonl');
    expect(canonical).toBeDefined();
    expect(canonical!.confidence).toBe(1.0);
    expect(canonical!.value).toContain('3x');
  });

  // === Schema detection ===

  it('extracts Prisma schema models', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/prisma/schema.prisma',
          content: `model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n\nmodel Comment {\n  id Int @id\n}`,
        },
      },
    ];
    const result = extractStructural(events);
    const schema = result.find((m) => m.key.startsWith('schema-prisma'));
    expect(schema).toBeDefined();
    expect(schema!.category).toBe('data');
    expect(schema!.value).toContain('User');
    expect(schema!.value).toContain('Post');
    expect(schema!.value).toContain('Comment');
  });

  it('extracts Drizzle schema tables', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/src/db/drizzle-schema.ts',
          content: `export const users = pgTable('users', {});\nexport const posts = pgTable('posts', {});`,
        },
      },
    ];
    const result = extractStructural(events);
    const schema = result.find((m) => m.key.startsWith('schema-drizzle'));
    expect(schema).toBeDefined();
    expect(schema!.value).toContain('users');
    expect(schema!.value).toContain('posts');
  });

  it('extracts Django models', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/app/models.py',
          content: `class ChocolateBar(Model):\n    name = CharField()\n\nclass Company(Model):\n    name = CharField()`,
        },
      },
    ];
    const result = extractStructural(events);
    const schema = result.find((m) => m.key.startsWith('schema-models'));
    expect(schema).toBeDefined();
    expect(schema!.value).toContain('ChocolateBar');
    expect(schema!.value).toContain('Company');
  });

  // === Database connections ===

  it('detects database connection from .env.example without storing credentials', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/.env.example',
          content: 'DATABASE_URL=postgres://user:pass@localhost:5432/mydb\nREDIS_URL=redis://localhost:6379',
        },
      },
    ];
    const result = extractStructural(events);
    const db = result.find((m) => m.key === 'db-connection');
    expect(db).toBeDefined();
    expect(db!.category).toBe('data');
    expect(db!.value).toContain('PostgreSQL');
    // Must NOT contain credentials
    expect(db!.value).not.toContain('user:pass');
    expect(db!.value).not.toContain('localhost:5432');
  });

  it('detects Prisma datasource provider', () => {
    const events: ToolEvent[] = [
      {
        tool: 'Write',
        input: {
          file_path: '/project/prisma/schema.prisma',
          content: `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n\nmodel User {\n  id Int @id\n}`,
        },
      },
    ];
    const result = extractStructural(events);
    const db = result.find((m) => m.key === 'db-connection-prisma');
    expect(db).toBeDefined();
    expect(db!.value).toContain('PostgreSQL');
    expect(db!.value).toContain('Prisma');
  });
});
