import { defineAgent } from 'eve';
export default defineAgent({
  description: 'Explain the saved numeric forecast probabilities and station calibration. Distinguish day-ahead forecasts from partial intraday forecasts. Never invent a probability or use future settlement information.',
  model: process.env.SWARM_RESEARCH_MODEL ?? 'openai/gpt-5-mini',
  defaultTools: false,
  limits: { sessionUsage: ({ window }) => window.outputTokens >= 3000 || (window.costUsd ?? 0) >= 0.10 },
});
