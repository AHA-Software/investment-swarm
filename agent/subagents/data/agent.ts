import { defineAgent } from 'eve';
export default defineAgent({
  description: 'Inspect market rules, exact station and settlement source, missing timestamps and forecast provenance. Identify data gaps; never silently substitute a different city station or settlement provider.',
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 3000 || (window.costUsd ?? 0) >= 0.10 },
});
