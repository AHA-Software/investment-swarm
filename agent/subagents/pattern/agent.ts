import { defineAgent } from 'eve';
export default defineAgent({
  description: 'Investigate forecast revisions, liquidity, and price patterns as hypotheses. State falsifiable tests, transaction costs, and chronological holdout requirements. Do not represent order-book imbalance as proven predictive advantage.',
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 3000 || (window.costUsd ?? 0) >= 0.10 },
});
