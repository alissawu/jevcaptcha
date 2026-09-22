/**
 * Fast grid solver - single vision call
 * 
 * Instead of describe → select, just ask the vision model directly
 * which tiles match the prompt.
 */

import type { GridChallenge, GridSolution, SolverConfig } from '../types.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * Solve grid captcha in a single vision call
 */
export async function solveGridFast(
  challenge: GridChallenge,
  config: SolverConfig
): Promise<GridSolution> {
  const baseUrl = config.vision.baseUrl || OPENROUTER_BASE;
  const model = config.vision.model || 'google/gemini-3.7-flash';
  
  const totalTiles = challenge.rows * challenge.cols;
  
  const prompt = `This is a ${challenge.rows}x${challenge.cols} captcha grid.
Tiles numbered 0-${totalTiles - 1}, left-to-right, top-to-bottom.

Task: ${challenge.prompt}

IMPORTANT: Only select tiles where the target object is clearly and unambiguously visible. Do NOT select tiles where you're uncertain or the object is partially obscured/distant.

Return ONLY JSON: {"tiles": [0, 3], "confidence": 0.9}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.vision.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${challenge.imageBase64}` } },
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
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse response: ${content}`);
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  return {
    tiles: parsed.tiles || [],
  };
}
