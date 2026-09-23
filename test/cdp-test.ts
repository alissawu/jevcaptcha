/**
 * Test captcha solver via CDP connection to remote Chrome
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
        { role: 'system', content: 'Select CAPTCHA tiles matching the target. Return ONLY a JSON array like [0, 3, 7]. Be conservative - only clear matches.' },
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
  console.log('Connecting to Chrome via CDP...');
  
  // Get browser websocket URL
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  
  // Replace local URL with ngrok URL
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  console.log('WebSocket URL:', wsUrl);
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected!\n');
  
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('Going to reCAPTCHA demo...');
    await page.goto('https://www.google.com/recaptcha/api2/demo');
    await page.waitForTimeout(2000);
    
    // Click checkbox
    console.log('Clicking checkbox...');
    const checkboxFrame = page.frameLocator('iframe[title="reCAPTCHA"]');
    await checkboxFrame.locator('.recaptcha-checkbox-border').click();
    await page.waitForTimeout(3000);
    
    // Check if passed without challenge
    const isChecked = await checkboxFrame.locator('.recaptcha-checkbox-checked').count();
    if (isChecked > 0) {
      console.log('✅ Passed without challenge!');
      await page.close();
      return;
    }
    
    // Get challenge frame
    const challengeFrame = page.frameLocator('iframe[title="recaptcha challenge expires in two minutes"]');
    
    const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper');
    const promptText = await promptEl.textContent() || '';
    console.log('Prompt:', promptText);
    
    // Get grid dimensions
    const table = challengeFrame.locator('table.rc-imageselect-table-33, table.rc-imageselect-table-44');
    const rows = await table.locator('tr').count();
    const cols = await table.locator('tr').first().locator('td').count();
    console.log(`Grid: ${rows}x${cols}`);
    
    const isDynamic = promptText.includes('none left');
    console.log(`Type: ${isDynamic ? 'dynamic' : 'static'}\n`);
    
    // Solve loop
    let round = 1;
    const maxRounds = isDynamic ? 5 : 1;
    
    while (round <= maxRounds) {
      console.log(`--- Round ${round} ---`);
      
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
        console.log('No matches found');
        break;
      }
      
      // Click tiles
      const allTiles = challengeFrame.locator('td.rc-imageselect-tile');
      for (const idx of tiles) {
        await allTiles.nth(idx).click();
        await page.waitForTimeout(300);
      }
      console.log('Clicked tiles');
      
      if (!isDynamic) break;
      
      await page.waitForTimeout(2000);
      round++;
    }
    
    // Click verify
    console.log('\nClicking verify...');
    await page.waitForTimeout(500);
    await challengeFrame.locator('#recaptcha-verify-button').click();
    await page.waitForTimeout(2500);
    
    // Check result
    const passed = await checkboxFrame.locator('.recaptcha-checkbox-checked').count();
    if (passed > 0) {
      console.log('\n✅ CAPTCHA SOLVED!');
    } else {
      const tryAgain = await challengeFrame.locator('.rc-imageselect-incorrect-response, .rc-imageselect-error-select-more').count();
      if (tryAgain > 0) {
        console.log('\n❌ Failed - wrong tiles or need more');
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
