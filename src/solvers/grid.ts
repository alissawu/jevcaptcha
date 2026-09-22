/**
 * Grid captcha solver (hCaptcha, reCAPTCHA v2)
 * 
 * Flow:
 * 1. Split grid into individual tiles (or use batch describe)
 * 2. Get text description for each tile via vision model
 * 3. Send descriptions + prompt to JEV
 * 4. Return tile indices to click
 */

import sharp from 'sharp';
import type { GridChallenge, GridSolution, SolverConfig } from '../types.js';
import { describeTiles, describeTilesBatch } from '../vision/describe.js';
import { selectTiles } from '../jev.js';

export interface GridSolverOptions {
  /** Use batch mode (single vision call for whole grid) vs per-tile */
  batchMode?: boolean;
}

/**
 * Split a grid image into individual tiles
 */
export async function splitGrid(
  imageBase64: string,
  rows: number,
  cols: number
): Promise<string[]> {
  const buffer = Buffer.from(imageBase64, 'base64');
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  const width = metadata.width!;
  const height = metadata.height!;
  const tileWidth = Math.floor(width / cols);
  const tileHeight = Math.floor(height / rows);
  
  const tiles: string[] = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = col * tileWidth;
      const top = row * tileHeight;
      
      const tileBuffer = await sharp(buffer)
        .extract({ left, top, width: tileWidth, height: tileHeight })
        .png()
        .toBuffer();
      
      tiles.push(tileBuffer.toString('base64'));
    }
  }
  
  return tiles;
}

/**
 * Solve a grid captcha challenge
 */
export async function solveGrid(
  challenge: GridChallenge,
  config: SolverConfig,
  options: GridSolverOptions = {}
): Promise<GridSolution> {
  const { batchMode = true } = options;
  
  let tileDescriptions;
  
  if (batchMode) {
    // Single vision call for the whole grid
    tileDescriptions = await describeTilesBatch(
      challenge.imageBase64,
      challenge.rows,
      challenge.cols,
      config.vision
    );
  } else {
    // Split and describe each tile individually
    const tiles = await splitGrid(
      challenge.imageBase64,
      challenge.rows,
      challenge.cols
    );
    tileDescriptions = await describeTiles(tiles, config.vision);
  }
  
  // Ask JEV which tiles match
  const jevResponse = await selectTiles(
    {
      prompt: challenge.prompt,
      tiles: tileDescriptions,
    },
    { apiKey: config.jevApiKey }
  );
  
  return {
    tiles: jevResponse.selectedIndices,
    reasoning: jevResponse.reasoning,
  };
}
