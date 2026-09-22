/**
 * End-to-end captcha test on reCAPTCHA demo
 * 
 * 1. Open demo page
 * 2. Click checkbox to trigger challenge
 * 3. Capture grid + prompt
 * 4. Solve with our two-stage solver
 * 5. Click the tiles
 * 6. Submit and check if it passes
 */

import { chromium } from 'playwright';
import { describeTilesBatch } from '../src/vision/describe.js';
import type { SolverConfig, TileDescription } from '../src/types.js';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const visionConfig: SolverConfig = {
  vision: {
    provider: 'openrouter',
    apiKey: OPENROUTER_KEY,
    model: 'qwen/qwen3-vl-8b-instruct',
  },
};

async function selectTiles(
  prompt: string,
  descriptions: TileDescription[]
): Promise<number[]> {
  const descText = descriptions
    .map(d => `Tile ${d.index}: ${d.description}`)
    .join('\n');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-flash',
      max_tokens: 256,
      temperature: 0,
      messages: [
        { 
          role: 'system', 
          content: `You select CAPTCHA tiles. Given descriptions and a target, return matching tile indices.
Be conservative - only include tiles that CLEARLY match. Return ONLY a JSON array like [0, 3, 7]` 
        },
        { role: 'user', content: `Target: ${prompt}\n\nDescriptions:\n${descText}\n\nJSON array:` },
      ],
    }),
  });

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '[]';
  const match = content.match(/\[[\d,\s]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

async function main() {
  console.log('Starting e2e captcha test...\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Go to demo
    await page.goto('https://www.google.com/recaptcha/api2/demo');
    await page.waitForTimeout(1000);
    
    // Click the checkbox
    const checkboxFrame = page.frameLocator('iframe[title="reCAPTCHA"]');
    await checkboxFrame.locator('.recaptcha-checkbox-border').click();
    await page.waitForTimeout(2000);
    
    // Find challenge iframe
    const challengeFrame = page.frameLocator('iframe[title="recaptcha challenge expires in two minutes"]');
    
    // Get prompt
    const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper');
    const promptText = await promptEl.textContent() || '';
    console.log('Prompt:', promptText);
    
    // Screenshot the grid
    const grid = challengeFrame.locator('.rc-imageselect-target');
    const gridBuffer = await grid.screenshot();
    const gridBase64 = gridBuffer.toString('base64');
    
    // Get grid dimensions
    const table = challengeFrame.locator('table.rc-imageselect-table-33, table.rc-imageselect-table-44');
    const rows = await table.locator('tr').count();
    const cols = await table.locator('tr').first().locator('td').count();
    console.log(`Grid: ${rows}x${cols}`);
    
    // Solve
    console.log('\nSolving...');
    const startTime = Date.now();
    
    const descriptions = await describeTilesBatch(gridBase64, rows, cols, visionConfig.vision);
    console.log('Descriptions:');
    for (const d of descriptions) {
      console.log(`  ${d.index}: ${d.description}`);
    }
    
    const tiles = await selectTiles(promptText, descriptions);
    const solveTime = Date.now() - startTime;
    console.log(`\nSelected tiles: [${tiles.join(', ')}] (${solveTime}ms)`);
    
    if (tiles.length === 0) {
      console.log('No tiles selected, aborting');
      await browser.close();
      return;
    }
    
    // Click tiles in a loop (for dynamic captchas)
    let round = 1;
    let currentTiles = tiles;
    
    while (currentTiles.length > 0 && round <= 5) {
      console.log(`\nRound ${round}: clicking tiles [${currentTiles.join(', ')}]...`);
      const allTiles = challengeFrame.locator('td.rc-imageselect-tile');
      
      for (const tileIndex of currentTiles) {
        await allTiles.nth(tileIndex).click();
        await page.waitForTimeout(300);
      }
      
      // Wait for new tiles to load
      await page.waitForTimeout(1500);
      
      // Check if this is a dynamic captcha (tiles regenerate)
      const isDynamic = promptText.includes('none left');
      if (!isDynamic) break;
      
      // Re-screenshot and solve
      const newGridBuffer = await grid.screenshot();
      const newGridBase64 = newGridBuffer.toString('base64');
      
      const newDescriptions = await describeTilesBatch(newGridBase64, rows, cols, visionConfig.vision);
      console.log('New descriptions:');
      for (const d of newDescriptions) {
        console.log(`  ${d.index}: ${d.description}`);
      }
      
      currentTiles = await selectTiles(promptText, newDescriptions);
      round++;
    }
    
    // Click verify
    console.log('\nClicking verify...');
    await page.waitForTimeout(500);
    await challengeFrame.locator('#recaptcha-verify-button').click();
    
    // Check result
    await page.waitForTimeout(2000);
    
    // Check if we passed (checkbox should be checked) or got new challenge
    const isChecked = await checkboxFrame.locator('.recaptcha-checkbox-checked').count();
    const hasNewChallenge = await challengeFrame.locator('.rc-imageselect-incorrect-response').count();
    
    if (isChecked > 0) {
      console.log('\n✅ PASSED! Captcha solved successfully');
    } else if (hasNewChallenge > 0) {
      console.log('\n❌ FAILED - got "Please try again" or new challenge');
    } else {
      console.log('\n⚠️ UNCLEAR - checking page state...');
      // Try submitting the form to see if we passed
      try {
        await page.locator('#recaptcha-demo-submit').click();
        await page.waitForTimeout(1000);
        const success = await page.locator('text=Verification Success').count();
        if (success > 0) {
          console.log('✅ PASSED! Form submitted successfully');
        } else {
          console.log('❌ FAILED - form submission failed');
        }
      } catch (e) {
        console.log('Could not verify result');
      }
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  // Keep browser open for inspection
  console.log('\nBrowser staying open for 10s...');
  await page.waitForTimeout(10000);
  await browser.close();
}

main().catch(console.error);
