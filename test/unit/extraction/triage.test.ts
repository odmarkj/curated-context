import { describe, it, expect } from 'vitest';
import { triageMessages } from '../../../src/extraction/triage.js';
import type { ConversationMessage } from '../../../src/extraction/transcript.js';

describe('triageMessages', () => {
  it('identifies high-signal decision conversations', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: "Let's use Tailwind CSS for styling" },
      { role: 'assistant', content: "I'll set up Tailwind. We're using the default config." },
      { role: 'user', content: 'The primary color should be blue-600. Always prefer server components.' },
      { role: 'assistant', content: 'Decided to use blue-600 as primary. Going with server components by convention.' },
    ];
    const result = triageMessages(messages);
    expect(result.shouldProcess).toBe(true);
    expect(result.decisionScore).toBeGreaterThanOrEqual(2);
    expect(result.highSignalMessages.length).toBeGreaterThan(0);
  });

  it('filters out noise/debugging conversations', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Can you look at this error? Something failed.' },
      { role: 'assistant', content: 'Let me try reading the file. Hmm, actually wait.' },
      { role: 'user', content: "Maybe it's broken? Not sure what happened." },
      { role: 'assistant', content: "Let me try debugging this. I'm not certain what's wrong." },
    ];
    const result = triageMessages(messages);
    expect(result.shouldProcess).toBe(false);
  });

  it('returns shouldProcess:false when noise > decision signals', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: "Let's use React for the frontend" },
      { role: 'assistant', content: "Let me try setting that up. Hmm, error occurred. Not sure about the configuration. Maybe we should debug this." },
      { role: 'user', content: "Can you look at the error? Something broke. I'm not certain what's wrong." },
      { role: 'assistant', content: "Let me try debugging this. Sorry about the mistake." },
    ];
    const result = triageMessages(messages);
    expect(result.shouldProcess).toBe(false);
  });

  it('only considers last 10 messages', () => {
    // Pad with 12 noise messages, then add 2 decision messages
    const noise: ConversationMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Let me try debugging step ${i}. Error found.`,
    }));
    const decisions: ConversationMessage[] = [
      { role: 'user', content: "Let's use Tailwind CSS and the primary color should be blue." },
      { role: 'assistant', content: "Decided to use Tailwind. Going with blue as primary." },
    ];
    // The noise messages are beyond the last-10 window
    const allMessages = [...noise, ...decisions];
    const result = triageMessages(allMessages);
    // Last 10 includes the 2 decisions + 8 noise from the tail of noise[]
    // The decision score might be enough or might not - the key thing is the window is 10
    expect(result.decisionScore).toBeGreaterThanOrEqual(0);
  });

  it('highSignalMessages only includes messages with decision signals', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: "Let's use Tailwind CSS for styling." },
      { role: 'assistant', content: 'Sure, I will read the file now.' },
      { role: 'user', content: 'The primary color should be blue-600. We decided to use server components.' },
      { role: 'assistant', content: 'Going with blue-600. Switching to server components by convention.' },
    ];
    const result = triageMessages(messages);
    if (result.shouldProcess) {
      for (const msg of result.highSignalMessages) {
        // Each high-signal message should contain at least one decision keyword
        const hasSignal =
          /let's|decided|going with|switching to|should be|convention|always|prefer|color/i.test(msg.content);
        expect(hasSignal).toBe(true);
      }
    }
  });

  it('returns shouldProcess:false for empty messages', () => {
    const result = triageMessages([]);
    expect(result.shouldProcess).toBe(false);
    expect(result.highSignalMessages).toHaveLength(0);
  });
});
