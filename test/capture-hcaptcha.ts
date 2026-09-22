/**
 * Capture a captcha from hCaptcha demo for testing
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function captureHCaptcha() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // hCaptcha demo page
  await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'networkidle' });
  
  // Click the checkbox to trigger the challenge
  const checkbox = page.frameLocator('iframe[title="Widget containing checkbox for hCaptcha security challenge"]').locator('#checkbox');
  await checkbox.click();
  
  // Wait for challenge to appear
  await page.waitForTimeout(2000);
  
  // Find the challenge iframe
  const challengeFrame = page.frameLocator('iframe[title="hCaptcha challenge"]');
  
  // Get the challenge prompt
  const promptEl = challengeFrame.locator('.prompt-text');
  const prompt = await promptEl.textContent().catch(() => 'Unknown prompt');
  console.log('Prompt:', prompt);
  
  // Screenshot the image grid
  const grid = challengeFrame.locator('.task-image');
  const gridBox = await grid.boundingBox();
  
  if (gridBox) {
    const screenshot = await page.screenshot({
      clip: {
        x: gridBox.x,
        y: gridBox.y,
        width: gridBox.width,
        height: gridBox.height,
      },
    });
    
    const outPath = path.join(import.meta.dirname, 'fixtures', 'hcaptcha_sample.png');
    fs.writeFileSync(outPath, screenshot);
    console.log(`Saved: ${outPath}`);
    console.log(`Grid size: ${gridBox.width}x${gridBox.height}`);
  } else {
    console.log('Could not find grid element');
    
    // Fallback: screenshot the whole challenge
    const screenshot = await page.screenshot();
    const outPath = path.join(import.meta.dirname, 'fixtures', 'hcaptcha_full.png');
    fs.writeFileSync(outPath, screenshot);
    console.log(`Saved full page: ${outPath}`);
  }
  
  await browser.close();
}

captureHCaptcha().catch(console.error);
