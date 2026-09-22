/**
 * Test fast grid solver
 */

import { solveGridFast, type SolverConfig, type GridChallenge } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';

const config: SolverConfig = {
  vision: {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: 'google/gemini-3.7-flash',  // fast, no reasoning overhead
  },
};

async function test() {
  const samplePath = path.join(import.meta.dirname, 'fixtures', 'sample_grid.png');
  
  if (!fs.existsSync(samplePath)) {
    console.log('No sample_grid.png in test/fixtures/');
    return;
  }
  
  const imageBase64 = fs.readFileSync(samplePath).toString('base64');
  
  const challenge: GridChallenge = {
    prompt: 'Select all images with a bus',
    imageBase64,
    rows: 3,
    cols: 3,
  };
  
  console.log('Solving with fast solver...');
  console.log(`Model: ${config.vision.model}`);
  
  const startTime = Date.now();
  const solution = await solveGridFast(challenge, config);
  const elapsed = Date.now() - startTime;
  
  console.log(`\nSolution (${elapsed}ms):`);
  console.log(`Tiles: [${solution.tiles.join(', ')}]`);
}

test().catch(console.error);
