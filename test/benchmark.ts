/**
 * Benchmark different models for grid solving
 */

import { solveGridFast, type SolverConfig, type GridChallenge } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';

const models = [
  'google/gemini-3.7-flash',
  'google/gemini-3.8-flash',
  'openai/gpt-4o-mini',
  'qwen/qwen3.7-flash',
];

async function benchmark() {
  const samplePath = path.join(import.meta.dirname, 'fixtures', 'sample_grid.png');
  const imageBase64 = fs.readFileSync(samplePath).toString('base64');
  
  const challenge: GridChallenge = {
    prompt: 'Select all images with a bus',
    imageBase64,
    rows: 3,
    cols: 3,
  };
  
  console.log('Benchmarking models...\n');
  
  for (const model of models) {
    const config: SolverConfig = {
      vision: {
        provider: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY!,
        model,
      },
    };
    
    try {
      const start = Date.now();
      const solution = await solveGridFast(challenge, config);
      const elapsed = Date.now() - start;
      console.log(`${model.padEnd(25)} ${elapsed}ms  tiles: [${solution.tiles.join(', ')}]`);
    } catch (e: any) {
      console.log(`${model.padEnd(25)} ERROR: ${e.message.slice(0, 50)}`);
    }
  }
}

benchmark().catch(console.error);
