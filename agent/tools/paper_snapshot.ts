import { defineTool } from 'eve/tools';
import { z } from 'zod';
export default defineTool({
  description: 'Read the local paper dashboard snapshot, including readiness, risk status and recent decisions. No mutations or credentials.',
  inputSchema: z.object({}),
  async execute() {
    const response=await fetch('http://127.0.0.1:4310/api/status',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Start the paper dashboard on port 4310 first');
    return response.json();
  },
});
