/**
 * JEV decision layer using TypeSafe AI
 * 
 * Takes text descriptions of captcha tiles and selects which match the prompt.
 * Uses TypeSafe's System One model for fast, calibrated decisions.
 */

import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { TileDescription } from './types.js';

export interface JevConfig {
  apiKey: string;
}

export interface JevGridRequest {
  prompt: string;  // e.g. "Select all images with buses"
  tiles: TileDescription[];
}

export interface JevGridResponse {
  selectedIndices: number[];
  probabilities: number[];  // noul values for each tile
}

/**
 * Ask which tiles match the captcha prompt using TypeSafe Jev
 */
export async function selectTiles(
  request: JevGridRequest,
  config: JevConfig
): Promise<JevGridResponse> {
  const client = new TypeSafeClient({ apiKey: config.apiKey });
  
  // Extract target from prompt (e.g. "Select all images with buses" -> "buses")
  const targetMatch = request.prompt.match(/(?:select all (?:images )?(?:with|containing|showing|of) )?(.+)/i);
  const target = targetMatch?.[1] || request.prompt;
  
  // Build state with all tile descriptions
  const state: Record<string, string> = {
    target: target,
  };
  for (const tile of request.tiles) {
    state[`tile_${tile.index}`] = tile.description;
  }
  
  // Build questions - one Noul per tile
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const tile of request.tiles) {
    questions[`tile_${tile.index}`] = noul(
      `Does \`tile_${tile.index}\` contain or depict a \`target\`?`
    );
  }
  
  const response = await client.systemOne({
    state,
    questions,
  });
  
  // Collect probabilities and select tiles above threshold
  const probabilities: number[] = [];
  const selectedIndices: number[] = [];
  
  for (const tile of request.tiles) {
    const answer = response.answers[`tile_${tile.index}`];
    const prob = answer.noul;
    probabilities[tile.index] = prob;
    
    // Select if probability > 0.5
    if (prob > 0.5) {
      selectedIndices.push(tile.index);
    }
  }
  
  // Sort by probability descending (for when we need top N)
  selectedIndices.sort((a, b) => probabilities[b] - probabilities[a]);
  
  return {
    selectedIndices,
    probabilities,
  };
}
