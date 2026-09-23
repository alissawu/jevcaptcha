/**
 * Test dynamic grid captcha - "keep clicking until none left"
 * 
 * reCAPTCHA moderate/hard often gives these
 */

import { chromium } from 'patchright';
import { describeTilesBatch } from '../src/vision/describe.js';
import type { SolverConfig, TileDescription } from '../src/types.js';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const visionConfig: SolverConfig = {
  vision: {
    provider: 'openrouter',
    apiKey: OPENROUTER_KEY,
    model: 'qwen/qwen3-vl-8b-instruct',
  },
};

async function selectTiles(prompt: string, descriptions: TileDescription[]): Promise<number[]> {
  const descText = descriptions.map(d => `Tile ${d.index}: ${d.description}`).join('\n');

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
          content: `Select CAPTCHA tiles matching the target. Return ONLY a JSON array like [0, 3, 7].
Be conservative - only select tiles that CLEARLY show the target object.
If no tiles match, return [].` 
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
  console.log('=== Dynamic Grid Captcha Test ===\n');
  console.log('Connecting to Chrome via CDP...');
  
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected!\n');
  
  // Use fresh incognito context to force challenges
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Use hard difficulty to get dynamic challenges
    console.log('Going to reCAPTCHA demo (hard)...');
    await page.goto('https://nopecha.com/captcha/recaptcha#hard');
    await page.waitForTimeout(3000);
    
    // Find and click the reCAPTCHA checkbox (first one, the visible normal-sized one)
    console.log('Looking for reCAPTCHA...');
    const recaptchaFrame = page.frameLocator('iframe[title*="reCAPTCHA"]').first();
    await recaptchaFrame.locator('.recaptcha-checkbox-border').click();
    await page.waitForTimeout(3000);
    
    // Check if passed without challenge
    const isChecked = await recaptchaFrame.locator('.recaptcha-checkbox-checked').count();
    if (isChecked > 0) {
      console.log('✅ Passed without challenge!');
      await page.close();
      return;
    }
    
    // Get challenge frame
    const challengeFrame = page.frameLocator('iframe[title*="recaptcha challenge"]');
    
    const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper');
    const promptText = await promptEl.textContent() || '';
    console.log('Prompt:', promptText);
    
    // Check if this is a dynamic challenge
    const isDynamic = promptText.toLowerCase().includes('none left') || 
                      promptText.toLowerCase().includes('keep clicking');
    console.log(`Type: ${isDynamic ? 'DYNAMIC' : 'STATIC'}\n`);
    
    if (!isDynamic) {
      console.log('Got static challenge, not dynamic. Try again or use "hard" difficulty.');
    }
    
    // Get grid dimensions
    const table = challengeFrame.locator('table.rc-imageselect-table-33, table.rc-imageselect-table-44');
    const rows = await table.locator('tr').count();
    const cols = await table.locator('tr').first().locator('td').count();
    console.log(`Grid: ${rows}x${cols}`);
    
    // Dynamic solve loop
    let round = 1;
    const maxRounds = isDynamic ? 8 : 1;
    let totalClicked = 0;
    
    while (round <= maxRounds) {
      console.log(`\n--- Round ${round} ---`);
      
      // Wait for any tile refresh animations
      await page.waitForTimeout(500);
      
      // Screenshot the grid
      const grid = challengeFrame.locator('.rc-imageselect-target');
      const gridBuffer = await grid.screenshot();
      const gridBase64 = gridBuffer.toString('base64');
      
      console.log('Describing tiles...');
      const startDesc = Date.now();
      const descriptions = await describeTilesBatch(gridBase64, rows, cols, visionConfig.vision);
      console.log(`Descriptions (${Date.now() - startDesc}ms):`);
      for (const d of descriptions) {
        console.log(`  ${d.index}: ${d.description}`);
      }
      
      console.log('Selecting tiles...');
      const startSelect = Date.now();
      const tiles = await selectTiles(promptText, descriptions);
      console.log(`Selected: [${tiles.join(', ')}] (${Date.now() - startSelect}ms)`);
      
      if (tiles.length === 0) {
        console.log('No more matches - ready to verify');
        break;
      }
      
      // Click each selected tile
      const allTiles = challengeFrame.locator('td.rc-imageselect-tile');
      for (const idx of tiles) {
        await allTiles.nth(idx).click();
        totalClicked++;
        // Wait for tile to refresh (dynamic grids replace clicked tiles)
        await page.waitForTimeout(800);
      }
      console.log(`Clicked ${tiles.length} tiles (total: ${totalClicked})`);
      
      round++;
    }
    
    // Click verify
    console.log('\nClicking verify...');
    await page.waitForTimeout(500);
    await challengeFrame.locator('#recaptcha-verify-button').click();
    await page.waitForTimeout(3000);
    
    // Check result
    const passed = await recaptchaFrame.locator('.recaptcha-checkbox-checked').count();
    if (passed > 0) {
      console.log('\n✅ CAPTCHA SOLVED!');
      console.log(`Total tiles clicked: ${totalClicked}`);
      console.log(`Rounds: ${round}`);
    } else {
      // Check for error messages
      const tryAgain = await challengeFrame.locator('.rc-imageselect-incorrect-response').count();
      const selectMore = await challengeFrame.locator('.rc-imageselect-error-select-more').count();
      const newChallenge = await challengeFrame.locator('.rc-imageselect-desc-wrapper').count();
      
      if (tryAgain > 0) {
        console.log('\n❌ Failed - incorrect selection');
      } else if (selectMore > 0) {
        console.log('\n❌ Failed - need to select more tiles');
      } else if (newChallenge > 0) {
        console.log('\n⚠️ Got a new challenge - may need another round');
      } else {
        console.log('\n❓ Unknown result');
      }
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  await page.close();
}

main().catch(console.error);
