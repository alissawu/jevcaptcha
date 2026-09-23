/**
 * Test captcha solving with stealth browser
 */

import { launchStealthBrowser, createStealthPage } from '../src/browser/stealth.js';
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
        { role: 'system', content: 'Select CAPTCHA tiles matching the target. Return ONLY a JSON array like [0, 3, 7]. Be conservative.' },
        { role: 'user', content: `Target: ${prompt}\n\nDescriptions:\n${descText}\n\nJSON array:` },
      ],
    }),
  });

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '[]';
  const match = content.match(/\[[\d,\s]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

async function testRecaptcha() {
  console.log('=== Stealth reCAPTCHA Test ===\n');
  
  const browser = await launchStealthBrowser({ headless: true });
  const { context, page } = await createStealthPage(browser);
  
  try {
    await page.goto('https://www.google.com/recaptcha/api2/demo');
    await page.waitForTimeout(1500);
    
    // Click checkbox
    const checkboxFrame = page.frameLocator('iframe[title="reCAPTCHA"]');
    await checkboxFrame.locator('.recaptcha-checkbox-border').click();
    await page.waitForTimeout(2500);
    
    // Check if we passed without challenge (low risk score)
    const isChecked = await checkboxFrame.locator('.recaptcha-checkbox-checked').count();
    if (isChecked > 0) {
      console.log('✅ Passed without challenge! (low risk score)');
      await browser.close();
      return;
    }
    
    // Get challenge
    const challengeFrame = page.frameLocator('iframe[title="recaptcha challenge expires in two minutes"]');
    
    const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper');
    const promptText = await promptEl.textContent() || '';
    console.log('Prompt:', promptText);
    
    const grid = challengeFrame.locator('.rc-imageselect-target');
    const gridBuffer = await grid.screenshot();
    const gridBase64 = gridBuffer.toString('base64');
    
    const table = challengeFrame.locator('table.rc-imageselect-table-33, table.rc-imageselect-table-44');
    const rows = await table.locator('tr').count();
    const cols = await table.locator('tr').first().locator('td').count();
    console.log(`Grid: ${rows}x${cols}`);
    
    // Dynamic vs static
    const isDynamic = promptText.includes('none left');
    console.log(`Type: ${isDynamic ? 'dynamic' : 'static'}`);
    
    // Solve loop
    let round = 1;
    const maxRounds = isDynamic ? 5 : 1;
    
    while (round <= maxRounds) {
      console.log(`\nRound ${round}:`);
      
      const currentGridBuffer = await grid.screenshot();
      const currentGridBase64 = currentGridBuffer.toString('base64');
      
      const descriptions = await describeTilesBatch(currentGridBase64, rows, cols, visionConfig.vision);
      console.log('Descriptions:');
      for (const d of descriptions) {
        console.log(`  ${d.index}: ${d.description}`);
      }
      
      const tiles = await selectTiles(promptText, descriptions);
      console.log(`Selected: [${tiles.join(', ')}]`);
      
      if (tiles.length === 0) {
        if (isDynamic) {
          console.log('No more matches, clicking verify...');
          break;
        } else {
          console.log('No matches found!');
          break;
        }
      }
      
      // Click tiles
      const allTiles = challengeFrame.locator('td.rc-imageselect-tile');
      for (const idx of tiles) {
        await allTiles.nth(idx).click();
        await page.waitForTimeout(250);
      }
      
      if (!isDynamic) break;
      
      // Wait for refresh
      await page.waitForTimeout(1500);
      round++;
    }
    
    // Verify
    await page.waitForTimeout(500);
    await challengeFrame.locator('#recaptcha-verify-button').click();
    await page.waitForTimeout(2000);
    
    // Check result
    const passed = await checkboxFrame.locator('.recaptcha-checkbox-checked').count();
    const failed = await challengeFrame.locator('.rc-imageselect-incorrect-response').count();
    
    if (passed > 0) {
      console.log('\n✅ PASSED!');
    } else if (failed > 0) {
      console.log('\n❌ FAILED - try again prompt');
    } else {
      // Try submitting form
      await page.locator('#recaptcha-demo-submit').click();
      await page.waitForTimeout(1000);
      const success = await page.locator('text=Verification Success').count();
      console.log(success > 0 ? '\n✅ PASSED!' : '\n❌ FAILED');
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/home/kit/jevcaptcha/test/stealth-error.png' });
  }
  
  await context.close();
  await browser.close();
}

async function testGeeTest() {
  console.log('\n=== Stealth GeeTest Test ===\n');
  
  const browser = await launchStealthBrowser({ headless: true });
  const { context, page } = await createStealthPage(browser);
  
  try {
    await page.goto('https://www.geetest.com/en/adaptive-captcha-demo');
    await page.waitForTimeout(2000);
    
    // Click Slide CAPTCHA tab with force
    console.log('Clicking Slide CAPTCHA...');
    await page.locator('text=Slide CAPTCHA').click({ force: true });
    await page.waitForTimeout(1500);
    
    // Click verify button
    console.log('Clicking verify...');
    await page.locator('text=Click to verify').click({ force: true });
    await page.waitForTimeout(3000);
    
    // Screenshot
    await page.screenshot({ path: '/home/kit/jevcaptcha/test/geetest-stealth.png', fullPage: true });
    console.log('Screenshot saved: geetest-stealth.png');
    
    // Look for slider
    const slider = page.locator('.geetest_slider_button');
    const sliderVisible = await slider.isVisible().catch(() => false);
    console.log('Slider visible:', sliderVisible);
    
    if (sliderVisible) {
      // Try to solve
      const sliderBox = await slider.boundingBox();
      if (sliderBox) {
        console.log('Dragging slider...');
        await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(sliderBox.x + 300, sliderBox.y + sliderBox.height / 2, { steps: 30 });
        await page.mouse.up();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/home/kit/jevcaptcha/test/geetest-after.png' });
      }
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/home/kit/jevcaptcha/test/geetest-error2.png' });
  }
  
  await context.close();
  await browser.close();
}

async function main() {
  await testRecaptcha();
  await testGeeTest();
}

main().catch(console.error);
