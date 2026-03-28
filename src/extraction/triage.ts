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
  // Infrastructure, hosting, and operations decisions
  /(?:hetzner|digitalocean|linode|vultr|ovh|render|railway|fly\.io|heroku|coolify|kamal|dokku)\b/i,
  /(?:vps|bare.?metal|dedicated server|cloud server|self.?host)/i,
  /(?:volume|storage|disk|lvm|partition|mount|filesystem|block storage|nfs)\s+/i,
  /(?:reverse proxy|load balancer|traefik|nginx|caddy|haproxy)\b/i,
  /(?:terraform|ansible|cloudformation|pulumi)\b/i,
  /(?:backup|snapshot|replication|disaster recovery|failover)/i,
  // Technology rejections and tradeoff decisions
  /(?:rejected|dropped|removed|excluded|abandoned|ruled out|won't use|not using|stopped using)\s+/i,
  /(?:instead of|rather than|over|replaced|switched from|moved away from|migrated from)\s+/i,
  /(?:too (?:expensive|complex|slow|limited|risky|much)|doesn't support|can't handle|not enough)\s+/i,
  /(?:the (?:reason|problem|issue|limitation|downside) (?:is|was|with))\s+/i,
  // Scalability, capacity planning, and selection rationale
  /(?:scalab|elastic|expandab|grow(?:th|able)|capacity|[0-9]+\s*[GT]B)\b/i,
  /(?:chose|selected|picked|went with)\s+.*\b(?:because|since|due to|for)\b/i,
  /(?:hot\s*(?:tier|storage)|cold\s*(?:tier|storage)|archiv(?:e|al)|tiered\s*storage)/i,
  /(?:minio|s3.?compatible|object storage|blob storage)\b/i,
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
 * Zero API calls. Scans ALL messages and extracts those with decision signals.
 */
export function triageMessages(messages: ConversationMessage[]): TriageResult {
  const text = messages.map((m) => m.content).join(' ');

  const decisionScore = DECISION_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  const noiseScore = NOISE_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  const shouldProcess = decisionScore >= 2 && decisionScore > noiseScore;

  // Extract ALL messages across the session that have decision signals
  const highSignalMessages = shouldProcess
    ? messages.filter((m) => {
        const msgDecision = DECISION_SIGNALS.reduce(
          (s, re) => s + (re.test(m.content) ? 1 : 0),
          0,
        );
        return msgDecision >= 1;
      })
    : [];

  return { shouldProcess, decisionScore, noiseScore, highSignalMessages };
}

// --- Conversation Mode Gating (Phase 2.9) ---

export type ConversationMode = 'casual' | 'debugging' | 'decision-heavy' | 'mixed';

/**
 * Classify a session's conversation mode based on signal density.
 * Used to gate extraction intensity — casual/debugging sessions skip Tier 4 LLM.
 */
export function classifyConversationMode(messages: ConversationMessage[]): ConversationMode {
  if (messages.length === 0) return 'casual';

  const text = messages.map((m) => m.content).join(' ');

  const decisionScore = DECISION_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  const noiseScore = NOISE_SIGNALS.reduce(
    (score, re) => score + (re.test(text) ? 1 : 0),
    0,
  );

  // Very few signals of any kind — casual/greeting
  if (decisionScore < 2 && noiseScore < 2) return 'casual';

  // Dominated by noise — debugging session
  if (noiseScore > decisionScore && noiseScore >= 3) return 'debugging';

  // Strong decision signals
  if (decisionScore >= 4 && decisionScore > noiseScore * 2) return 'decision-heavy';

  return 'mixed';
}
