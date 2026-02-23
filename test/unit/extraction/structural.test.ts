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

  it('ignores non-Write/Edit tool events', () => {
    const events: ToolEvent[] = [
      { tool: 'Read', input: { file_path: '/project/src/styles/globals.css' } },
      { tool: 'Glob', input: { pattern: '**/*.css' } },
    ];
    const result = extractStructural(events);
    expect(result).toHaveLength(0);
  });

  it('ignores Write events with empty content', () => {
    const events: ToolEvent[] = [
      { tool: 'Write', input: { file_path: '/project/src/styles/globals.css', content: '' } },
    ];
    const result = extractStructural(events);
    expect(result).toHaveLength(0);
  });
});
