/**
 * Grid CAPTCHA solvers - static and dynamic variants
 * Uses TypeSafe Jev for tile selection
 */

import type { Page, FrameLocator } from 'playwright';
import { describeTilesBatch } from '../vision/describe.js';
import { selectTiles } from '../jev.js';
import type { SolverConfig, TileDescription } from '../types.js';

export interface GridSolveResult {
  success: boolean;
  rounds: number;
  totalTiles: number[];
  probabilities?: number[];
  duration: number;
  error?: string;
}

interface GridContext {
  page: Page;
  frame?: FrameLocator;
  config: SolverConfig;
}

/**
 * Solve a static grid CAPTCHA (select tiles once, then verify)
 * 
 * Use when prompt is like "Select all squares with X"
 */
export async function solveStaticGrid(
  ctx: GridContext,
  gridSelector: string,
  tileSelector: string,
  prompt: string,
  rows: number,
  cols: number
): Promise<GridSolveResult> {
  const startTime = Date.now();
  const allTiles: number[] = [];
  
  try {
    const container = ctx.frame 
      ? ctx.frame.locator(gridSelector)
      : ctx.page.locator(gridSelector);
    
    // Screenshot grid
    const gridBuffer = await container.screenshot();
    const gridBase64 = gridBuffer.toString('base64');
    
    // Describe tiles
    const descriptions = await describeTilesBatch(gridBase64, rows, cols, ctx.config.vision);
    
    // Select matching tiles using TypeSafe Jev
    const jevResult = await selectTiles(
      { prompt, tiles: descriptions },
      ctx.config.jev
    );
    
    allTiles.push(...jevResult.selectedIndices);
    
    // Click tiles
    const tileElements = ctx.frame
      ? ctx.frame.locator(tileSelector)
      : ctx.page.locator(tileSelector);
    
    for (const idx of jevResult.selectedIndices) {
      await tileElements.nth(idx).click();
      await ctx.page.waitForTimeout(200);
    }
    
    return {
      success: true,
      rounds: 1,
      totalTiles: allTiles,
      probabilities: jevResult.probabilities,
      duration: Date.now() - startTime,
    };
    
  } catch (e: any) {
    return {
      success: false,
      rounds: 0,
      totalTiles: allTiles,
      duration: Date.now() - startTime,
      error: e.message,
    };
  }
}

/**
 * Solve a dynamic grid CAPTCHA (tiles refresh after clicking, repeat until clear)
 * 
 * Use when prompt contains "Click verify once there are none left"
 */
export async function solveDynamicGrid(
  ctx: GridContext,
  gridSelector: string,
  tileSelector: string,
  prompt: string,
  rows: number,
  cols: number,
  maxRounds: number = 5
): Promise<GridSolveResult> {
  const startTime = Date.now();
  const allTiles: number[] = [];
  let round = 0;
  let lastProbabilities: number[] | undefined;
  
  try {
    const container = ctx.frame 
      ? ctx.frame.locator(gridSelector)
      : ctx.page.locator(gridSelector);
    
    const tileElements = ctx.frame
      ? ctx.frame.locator(tileSelector)
      : ctx.page.locator(tileSelector);
    
    while (round < maxRounds) {
      round++;
      
      // Screenshot grid
      const gridBuffer = await container.screenshot();
      const gridBase64 = gridBuffer.toString('base64');
      
      // Describe tiles
      const descriptions = await describeTilesBatch(gridBase64, rows, cols, ctx.config.vision);
      
      // Select matching tiles using TypeSafe Jev
      const jevResult = await selectTiles(
        { prompt, tiles: descriptions },
        ctx.config.jev
      );
      
      lastProbabilities = jevResult.probabilities;
      
      // If no matches, we're done
      if (jevResult.selectedIndices.length === 0) {
        break;
      }
      
      allTiles.push(...jevResult.selectedIndices);
      
      // Click tiles
      for (const idx of jevResult.selectedIndices) {
        await tileElements.nth(idx).click();
        await ctx.page.waitForTimeout(300);
      }
      
      // Wait for tiles to refresh
      await ctx.page.waitForTimeout(1500);
    }
    
    return {
      success: true,
      rounds: round,
      totalTiles: allTiles,
      probabilities: lastProbabilities,
      duration: Date.now() - startTime,
    };
    
  } catch (e: any) {
    return {
      success: false,
      rounds: round,
      totalTiles: allTiles,
      duration: Date.now() - startTime,
      error: e.message,
    };
  }
}

/**
 * Auto-detect and solve grid CAPTCHA
 */
export async function solveGridAuto(
  ctx: GridContext,
  gridSelector: string,
  tileSelector: string,
  prompt: string,
  rows: number,
  cols: number
): Promise<GridSolveResult> {
  // Check if dynamic (prompt mentions "none left" or similar)
  const isDynamic = /none left|no more|until.*clear/i.test(prompt);
  
  if (isDynamic) {
    return solveDynamicGrid(ctx, gridSelector, tileSelector, prompt, rows, cols);
  } else {
    return solveStaticGrid(ctx, gridSelector, tileSelector, prompt, rows, cols);
  }
}
