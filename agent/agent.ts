import { defineAgent } from 'eve';
export default defineAgent({
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 6000 || (window.costUsd ?? 0) >= 0.25 },
});
