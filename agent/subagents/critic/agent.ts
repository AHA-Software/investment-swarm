import { defineAgent } from 'eve';
export default defineAgent({
  description: 'Challenge research proposals for unsupported conclusions, contract misinterpretation, stale evidence, correlated event exposure, liquidity and overfitting. Default to abstention when key evidence is absent.',
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 3000 || (window.costUsd ?? 0) >= 0.10 },
});
