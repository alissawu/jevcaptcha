/**
 * TypeSafe/JEV API wrapper
 * 
 * JEV is a text-only decision model - we feed it structured descriptions
 * of captcha tiles and it returns which ones match the prompt.
 */

import type { TileDescription } from './types.js';

const JEV_BASE_URL = 'https://api.typesafe.ai/v1';

export interface JevConfig {
  apiKey: string;
  model?: string;  // default: jev-1
}

export interface JevGridRequest {
  prompt: string;  // e.g. "Select all images with buses"
  tiles: TileDescription[];
}

export interface JevGridResponse {
  selectedIndices: number[];
  reasoning?: string[];
}

/**
 * Ask JEV which tiles match the captcha prompt
 */
export async function selectTiles(
  request: JevGridRequest,
  config: JevConfig
): Promise<JevGridResponse> {
  const model = config.model || 'jev-1';
  
  // Format tiles as structured state for JEV
  const tileList = request.tiles
    .map(t => `[${t.index}] ${t.description}`)
    .join('\n');
  
  const systemPrompt = `You are solving a captcha grid challenge.
You will receive:
1. A prompt describing what to select (e.g. "Select all images with buses")
2. A list of tile descriptions, each with an index

Return a JSON object with:
- "selected": array of tile indices that match the prompt
- "reasoning": brief explanation for each selection

Be conservative - only select tiles that clearly match. If uncertain, don't select.`;

  const userPrompt = `Prompt: ${request.prompt}

Tiles:
${tileList}

Which tiles match? Return JSON: {"selected": [indices], "reasoning": ["why"]}`;

  const response = await fetch(`${JEV_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 256,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JEV API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '';
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse JEV response: ${content}`);
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  return {
    selectedIndices: parsed.selected || [],
    reasoning: parsed.reasoning,
  };
}
