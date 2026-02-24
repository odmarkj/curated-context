import type { ConversationMessage } from './transcript.js';

const DECISION_SIGNALS: RegExp[] = [
  /(?:let's|we'll|I'll|going to|decided to|switching to|using)\s+/i,
  /(?:the (?:primary|accent|background) color|theme|font|layout)\s+(?:is|should be|will be)/i,
  /(?:we're using|stack is|chose|picked|going with)\s+/i,
  /(?:header|footer|sidebar|nav|api|endpoint|route|schema)\s+(?:should|will|must)/i,
  /(?:convention|pattern|standard|rule):\s+/i,
  /(?:always|never|prefer|avoid)\s+/i,
  /(?:architecture|design system|component library|state management)/i,
  /(?:database|orm|authentication|authorization)\s+(?:is|uses?|with)/i,
  /(?:deploy(?:ing|ed|s)?|hosting|wrangler|vercel|netlify|cloudflare|aws|gcloud)\s+/i,
  /(?:I (?:usually|typically|normally|generally|always) use)\s+/i,
  /(?:I prefer|my go-to|I like to use|I tend to use|my preference is)\s+/i,
  /(?:for (?:backend|frontend|styling|testing|deployment|CI),?\s+(?:I|we)\s+(?:use|prefer|like))/i,
  /(?:data\s*(?:file|source|set|base)|single source of truth|canonical\s+(?:data|file|source))/i,
  /(?:schema|table|model|migration|column|field)\s+(?:is|has|should|must|contains)/i,
  /(?:scrape[ds]?|ingest|import|export|etl|pipeline)\s+(?:data|from|to|into)/i,
  /(?:\.jsonl|\.csv|\.parquet|\.pickle|\.sqlite)\b/i,
];

const NOISE_SIGNALS: RegExp[] = [
  /(?:let me try|hmm|actually wait|no that's wrong|error:|failed)/i,
  /(?:can you|what if|maybe|not sure|I'm not certain)/i,
  /(?:reading file|searching|listing|looking at)/i,
  /(?:debugging|troubleshoot|fix(?:ing)?|broke|broken)/i,
  /(?:oops|sorry|mistake|undo|revert)/i,
];

export interface TriageResult {
  shouldProcess: boolean;
  decisionScore: number;
  noiseScore: number;
  highSignalMessages: ConversationMessage[];
}

/**
 * Deterministic triage — score conversation messages by decision signal density.
 * Zero API calls. Filters out ~75% of turns.
 */
export function triageMessages(messages: ConversationMessage[]): TriageResult {
  // Focus on recent messages (last 10 turns)
  const recent = messages.slice(-10);
  const text = recent.map((m) => m.content).join(' ');

  const decisionScore = DECISION_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  const noiseScore = NOISE_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  const shouldProcess = decisionScore >= 2 && decisionScore > noiseScore;

  // Extract the specific messages with high signal
  const highSignalMessages = shouldProcess
    ? recent.filter((m) => {
        const msgDecision = DECISION_SIGNALS.reduce(
          (s, re) => s + (re.test(m.content) ? 1 : 0),
          0,
        );
        return msgDecision >= 1;
      })
    : [];

  return { shouldProcess, decisionScore, noiseScore, highSignalMessages };
}
