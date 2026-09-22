/**
 * Vision module - converts images to text descriptions
 * 
 * Uses vision-language models to describe captcha tiles.
 * The descriptions are then fed to JEV for selection.
 */

import type { TileDescription, SolverConfig } from '../types.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * Describe a single tile image
 */
export async function describeTile(
  imageBase64: string,
  config: SolverConfig['vision']
): Promise<string> {
  const baseUrl = config.baseUrl || OPENROUTER_BASE;
  const model = config.model || 'qwen/qwen-2.5-vl-7b-instruct';
  
  const prompt = `Describe this image tile in 5-15 words. Focus on:
- Main objects (vehicles, animals, signs, buildings, nature)
- Object types (bus, car, bicycle, traffic light, crosswalk, fire hydrant)
- Visibility (full view, partial, obscured)

Be factual and specific. Example: "Yellow school bus, full side view, parked"`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || 'Unknown';
}

/**
 * Describe all tiles in a grid
 */
export async function describeTiles(
  tilesBase64: string[],
  config: SolverConfig['vision']
): Promise<TileDescription[]> {
  // Process tiles in parallel with concurrency limit
  const concurrency = 4;
  const results: TileDescription[] = [];
  
  for (let i = 0; i < tilesBase64.length; i += concurrency) {
    const batch = tilesBase64.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (img, j) => {
        const index = i + j;
        const description = await describeTile(img, config);
        return { index, description };
      })
    );
    results.push(...batchResults);
  }
  
  return results.sort((a, b) => a.index - b.index);
}

/**
 * Batch describe all tiles in a single vision call (more efficient)
 * Only works with models that support multiple images or grid analysis
 */
export async function describeTilesBatch(
  gridImageBase64: string,
  rows: number,
  cols: number,
  config: SolverConfig['vision']
): Promise<TileDescription[]> {
  const baseUrl = config.baseUrl || OPENROUTER_BASE;
  const model = config.model || 'qwen/qwen-2.5-vl-7b-instruct';
  
  const totalTiles = rows * cols;
  
  const prompt = `This is a ${rows}x${cols} captcha grid (${totalTiles} tiles total).
Tiles are numbered 0-${totalTiles - 1}, left-to-right, top-to-bottom.

For each tile, describe the main content in 5-10 words.
Focus on: vehicles, traffic lights, crosswalks, fire hydrants, buses, bicycles, bridges, stairs, chimneys, parking meters, tractors, motorcycles, boats, planes, palm trees, mountains.

Return JSON array: [{"tile": 0, "desc": "..."}, {"tile": 1, "desc": "..."}, ...]`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${gridImageBase64}` } },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '';
  
  // Parse JSON array from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse batch response: ${content}`);
  }
  
  const parsed = JSON.parse(jsonMatch[0]) as Array<{tile: number, desc: string}>;
  
  return parsed.map(t => ({
    index: t.tile,
    description: t.desc,
  }));
}
