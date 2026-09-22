/**
 * Two-stage solver test
 * 
 * Stage 1: qwen3-vl-8b-instruct describes tiles (cheap vision)
 * Stage 2: deepseek-v4.1-flash selects matches (cheap text)
 */

import { describeTilesBatch } from '../src/vision/describe.js';
import type { SolverConfig, TileDescription } from '../src/types.js';
import * as fs from 'fs';
import * as path from 'path';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

// Stage 1: Vision model for descriptions
const visionConfig: SolverConfig = {
  vision: {
    provider: 'openrouter',
    apiKey: OPENROUTER_KEY,
    model: 'qwen/qwen3-vl-8b-instruct',  // $0.117/M - cheapest vision
  },
};

// Stage 2: Text model for selection
async function selectTiles(
  prompt: string,
  descriptions: TileDescription[]
): Promise<number[]> {
  const descText = descriptions
    .map(d => `Tile ${d.index}: ${d.description}`)
    .join('\n');

  const systemPrompt = `You are a CAPTCHA solver. Given tile descriptions and a target, return which tiles match.
Be conservative - only include tiles that CLEARLY match. If uncertain, exclude.
Return ONLY a JSON array of tile indices, e.g. [0, 3, 7]`;

  const userPrompt = `Target: ${prompt}

Tile descriptions:
${descText}

Which tiles match the target? Return JSON array only.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-flash',  // $0.15/M - newer, more consistent
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Selection API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '[]';
  
  console.log('Selection raw:', content);
  
  const match = content.match(/\[[\d,\s]*\]/);
  if (!match) {
    console.log('Selection response:', content);
    return [];
  }
  
  return JSON.parse(match[0]);
}

async function test() {
  const samplePath = path.join(import.meta.dirname, 'fixtures', 'sample_grid.png');
  
  if (!fs.existsSync(samplePath)) {
    console.log('No sample_grid.png');
    return;
  }
  
  const imageBase64 = fs.readFileSync(samplePath).toString('base64');
  const prompt = 'Select all images with a bus';
  
  console.log('=== Two-Stage Solver Test ===\n');
  console.log('Vision model: qwen/qwen3-vl-8b-instruct ($0.12/M)');
  console.log('Selection model: deepseek/deepseek-v4.1-flash ($0.15/M)\n');
  
  // Stage 1: Describe
  console.log('Stage 1: Describing tiles...');
  const descStart = Date.now();
  const descriptions = await describeTilesBatch(imageBase64, 3, 3, visionConfig.vision);
  const descTime = Date.now() - descStart;
  
  console.log(`Descriptions (${descTime}ms):`);
  for (const d of descriptions) {
    console.log(`  Tile ${d.index}: ${d.description}`);
  }
  
  // Stage 2: Select
  console.log('\nStage 2: Selecting matches...');
  const selStart = Date.now();
  const tiles = await selectTiles(prompt, descriptions);
  const selTime = Date.now() - selStart;
  
  console.log(`\nResult (${selTime}ms): [${tiles.join(', ')}]`);
  console.log(`Total time: ${descTime + selTime}ms`);
  console.log(`\nExpected: [0, 8]`);
}

test().catch(console.error);
