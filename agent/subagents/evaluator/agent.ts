import { defineAgent } from 'eve';
export default defineAgent({
  description: 'Assess forward-paper calibration, net results, costs, dependence between cities and days, and failed exits. Separate fixture results from real evidence. Propose changes for human review; never promote them.',
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 3000 || (window.costUsd ?? 0) >= 0.10 },
});
