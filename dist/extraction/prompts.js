export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction agent for a software developer's CLI workflow.

Given a conversation transcript, extract:
1. **Project decisions** — architecture choices, design tokens, API patterns,
   naming conventions, theme/style definitions, tech stack decisions
2. **Global preferences** — technology preferences (languages, frameworks,
   deployment, tooling, style), coding style, and workflow patterns that
   apply across projects. Use the "preferences" category with pref-* keys.
3. **Corrections** — if the user corrected a previous approach, note the
   preferred way

Output JSON only, no other text:
{
  "project_memories": [
    { "category": "design|architecture|api|conventions|config|tooling|gotchas|preferences",
      "key": "short identifier",
      "value": "concise description",
      "confidence": 0.0-1.0 }
  ],
  "global_memories": [
    { "category": "design|architecture|api|conventions|config|tooling|gotchas|preferences",
      "key": "short identifier",
      "value": "concise description",
      "confidence": 0.0-1.0 }
  ],
  "supersedes": ["keys that this new info replaces"]
}

Rules:
- Only extract HIGH-SIGNAL information. Skip chitchat, debugging, and exploration.
- Confidence threshold: only include items where you're 0.7+ confident this is a deliberate decision.
- Max 10 memories per extraction.
- Keep values concise (under 100 chars each).
- Categories: architecture (tech stack, patterns), design (colors, fonts, layout), api (routes, auth),
  conventions (naming, style), config (env, build), tooling (dev tools, CI), gotchas (pitfalls, warnings),
  preferences (cross-project technology preferences).
- For global_memories, use the "preferences" category for technology preferences:
  - Language: key "pref-lang-{name}", e.g. "pref-lang-python": "Prefers for backend and ML"
  - Framework: key "pref-framework-{name}", e.g. "pref-framework-nextjs": "Prefers for React frontends"
  - Deployment: key "pref-deploy-{name}", e.g. "pref-deploy-cloudflare": "Deploys via wrangler CLI"
  - Tooling: key "pref-tool-{name}", e.g. "pref-tool-vitest": "Prefers over Jest for testing"
  - Style: key "pref-style-{name}", e.g. "pref-style-tailwind": "Prefers for CSS in most projects"
- Preferences are suggestions, not rules. Phrase values as "Prefers..." or "Uses..." not "Always uses..."
- Infer preferences from repeated usage patterns or explicit statements like "I prefer", "my go-to", "I usually use".`;
export function buildExtractionPrompt(messages, existingMemories) {
    const existingStr = Object.values(existingMemories)
        .map((m) => `- ${m.key}: ${m.value}`)
        .join('\n');
    const conversationStr = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n');
    return [
        existingStr ? `Existing memories (do not duplicate):\n${existingStr}\n` : '',
        `Conversation transcript:\n${conversationStr}`,
    ]
        .filter(Boolean)
        .join('\n');
}
//# sourceMappingURL=prompts.js.map