/**
 * Test grid solver against sample captcha images
 */

import { solveGrid, type SolverConfig, type GridChallenge } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';

const config: SolverConfig = {
  jevApiKey: process.env.TYPESAFE_API_KEY!,
  vision: {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: 'qwen/qwen-2.5-vl-7b-instruct',  // cheap and good
  },
};

async function testWithSample() {
  // Check for fixture images
  const fixturesDir = path.join(import.meta.dirname, 'fixtures');
  const samplePath = path.join(fixturesDir, 'sample_grid.png');
  
  if (!fs.existsSync(samplePath)) {
    console.log('No sample_grid.png in test/fixtures/');
    console.log('To test: add a captcha grid screenshot and update the prompt below');
    console.log('\nRunning with placeholder test...\n');
    return;
  }
  
  const imageBase64 = fs.readFileSync(samplePath).toString('base64');
  
  const challenge: GridChallenge = {
    prompt: 'Select all images containing buses',  // update for your sample
    imageBase64,
    rows: 3,
    cols: 3,
  };
  
  console.log('Solving grid captcha...');
  console.log(`Prompt: ${challenge.prompt}`);
  console.log(`Grid: ${challenge.rows}x${challenge.cols}`);
  
  const startTime = Date.now();
  const solution = await solveGrid(challenge, config);
  const elapsed = Date.now() - startTime;
  
  console.log(`\nSolution (${elapsed}ms):`);
  console.log(`Tiles to click: [${solution.tiles.join(', ')}]`);
  if (solution.reasoning) {
    console.log('\nReasoning:');
    solution.reasoning.forEach((r, i) => console.log(`  ${i}: ${r}`));
  }
}

async function testDescribeOnly() {
  // Test just the vision description without JEV
  const { describeTilesBatch } = await import('../src/vision/describe.js');
  
  const fixturesDir = path.join(import.meta.dirname, 'fixtures');
  const samplePath = path.join(fixturesDir, 'sample_grid.png');
  
  if (!fs.existsSync(samplePath)) {
    console.log('Add test/fixtures/sample_grid.png to test vision descriptions');
    return;
  }
  
  const imageBase64 = fs.readFileSync(samplePath).toString('base64');
  
  console.log('Describing tiles...');
  const descriptions = await describeTilesBatch(imageBase64, 3, 3, config.vision);
  
  console.log('\nTile descriptions:');
  descriptions.forEach(d => {
    console.log(`  [${d.index}] ${d.description}`);
  });
}

// Run tests
const args = process.argv.slice(2);
if (args.includes('--describe')) {
  testDescribeOnly().catch(console.error);
} else {
  testWithSample().catch(console.error);
}
