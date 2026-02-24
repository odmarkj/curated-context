import { writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MemoryStore } from './memory-store.js';
import { getMemoriesByCategory } from './memory-store.js';

const RULES_PREFIX = 'cc-';
const MAX_RULES_FILE_SIZE = 1024; // 1KB per file
const MAX_DATA_RULES_SIZE = 2048; // 2KB for data category

/**
 * Write categorized memory files to .claude/rules/cc-<category>.md
 * For projects: <projectRoot>/.claude/rules/
 * For global (__global__): ~/.claude/rules/
 */
export function writeRulesFiles(projectRoot: string, store: MemoryStore): void {
  if (!projectRoot) return;

  const rulesDir = projectRoot === '__global__'
    ? join(homedir(), '.claude', 'rules')
    : join(projectRoot, '.claude', 'rules');
  mkdirSync(rulesDir, { recursive: true });

  const grouped = getMemoriesByCategory(store);
  const writtenCategories = new Set<string>();

  for (const [category, memories] of Object.entries(grouped)) {
    const filename = `${RULES_PREFIX}${category}.md`;
    const filePath = join(rulesDir, filename);
    const maxSize = category === 'data' ? MAX_DATA_RULES_SIZE : MAX_RULES_FILE_SIZE;

    let content = buildCategoryContent(category, memories);

    // Enforce size limit — trim oldest entries if too large
    if (Buffer.byteLength(content, 'utf8') > maxSize) {
      const sorted = [...memories].sort((a, b) => b.updatedAt - a.updatedAt);
      content = buildCategoryContent(category, sorted, maxSize);
    }

    writeFileSync(filePath, content);
    writtenCategories.add(filename);
  }

  // Clean up rule files for categories that no longer have memories
  try {
    const existingFiles = readdirSync(rulesDir).filter(
      (f) => f.startsWith(RULES_PREFIX) && f.endsWith('.md'),
    );

    for (const file of existingFiles) {
      if (!writtenCategories.has(file)) {
        unlinkSync(join(rulesDir, file));
      }
    }
  } catch {
    // Best effort cleanup
  }
}

interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: number;
}

function buildCategoryContent(category: string, memories: MemoryEntry[], sizeLimit?: number): string {
  if (category === 'data') {
    return buildDataContent(memories, sizeLimit);
  }
  if (category === 'preferences') {
    return buildPreferencesContent(memories, sizeLimit);
  }
  return buildDefaultContent(category, memories, sizeLimit);
}

function buildDefaultContent(category: string, memories: MemoryEntry[], sizeLimit?: number): string {
  const description = `${capitalize(category)} context (auto-managed by curated-context)`;
  let content = `---\ndescription: ${description}\n---\n\n`;

  for (const mem of memories) {
    const line = `- **${mem.key}**: ${mem.value}\n`;
    if (sizeLimit && Buffer.byteLength(content + line, 'utf8') > sizeLimit) break;
    content += line;
  }

  return content;
}

function buildPreferencesContent(memories: MemoryEntry[], sizeLimit?: number): string {
  const description = 'Technology preferences inferred from usage patterns (auto-managed by curated-context). These are suggestions — offer as options, do not auto-apply.';
  let content = `---\ndescription: ${description}\n---\n\n`;
  content += `_These are the developer's observed preferences. Suggest or offer as options when relevant, but do not automatically apply them._\n\n`;

  for (const mem of memories) {
    const line = `- **${mem.key}**: ${mem.value} _(preference)_\n`;
    if (sizeLimit && Buffer.byteLength(content + line, 'utf8') > sizeLimit) break;
    content += line;
  }

  return content;
}

function buildDataContent(memories: MemoryEntry[], sizeLimit?: number): string {
  const maxSize = sizeLimit ?? MAX_DATA_RULES_SIZE;
  let content = `---\ndescription: Canonical data sources and schemas for this project (auto-managed by curated-context). Always reference these before creating new data files.\nglobs:\nalwaysApply: true\n---\n\n`;
  content += `**These are the project's canonical data sources. Always use these files and schemas rather than creating new ones. Check here before creating any new data files.**\n\n`;

  // Group by key prefix
  const dataFiles = memories.filter((m) => m.key.startsWith('data-file-') || m.key.startsWith('canonical-'));
  const schemas = memories.filter((m) => m.key.startsWith('schema-'));
  const connections = memories.filter((m) => m.key.startsWith('db-connection'));
  const migrations = memories.filter((m) => m.key.startsWith('migration-'));
  const other = memories.filter((m) =>
    !m.key.startsWith('data-file-') && !m.key.startsWith('canonical-') &&
    !m.key.startsWith('schema-') && !m.key.startsWith('db-connection') &&
    !m.key.startsWith('migration-'),
  );

  const sections: Array<{ heading: string; items: MemoryEntry[] }> = [
    { heading: '### Data Files', items: dataFiles },
    { heading: '### Database Schemas', items: schemas },
    { heading: '### Database Connections', items: connections },
    { heading: '### Migrations', items: migrations },
    { heading: '### Other', items: other },
  ];

  for (const section of sections) {
    if (section.items.length === 0) continue;
    const headingLine = `${section.heading}\n`;
    if (Buffer.byteLength(content + headingLine, 'utf8') > maxSize) break;
    content += headingLine;
    for (const mem of section.items) {
      const line = `- **${mem.key}**: ${mem.value}\n`;
      if (Buffer.byteLength(content + line, 'utf8') > maxSize) break;
      content += line;
    }
    content += '\n';
  }

  return content;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
