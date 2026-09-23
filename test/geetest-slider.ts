/**
 * GeeTest slider with improved gap detection
 */

import { chromium } from 'patchright';
import * as fs from 'fs';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

async function findGapWithVision(bgBase64: string, sliceBase64: string): Promise<number | null> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen-2.5-vl-72b-instruct',
      max_tokens: 512,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `This is a GeeTest slider CAPTCHA. I have two images:

IMAGE 1: The background (300px wide). It contains a gap/cutout where the puzzle piece must slide into. The gap appears as a darker jigsaw-shaped shadow or hole.

IMAGE 2: The puzzle piece (about 60px wide) that slides from the LEFT edge into the gap.

Your task: Find the X pixel position (from LEFT edge, 0-260) of the GAP's LEFT EDGE in the background image.

Look carefully at the background image for a jigsaw-puzzle-shaped darker area or shadow. This is usually somewhere in the left-middle portion (x=30-150).

IMPORTANT: The puzzle piece STARTS at x=0. I need to know how far RIGHT to drag it.

Return ONLY: {"gap_x": <number between 20 and 260>}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${bgBase64}` }
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${sliceBase64}` }
            }
          ]
        }
      ],
    }),
  });

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '';
  console.log('Vision response:', content);
  
  const match = content.match(/"gap_x"\s*:\s*(\d+)/);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

async function main() {
  console.log('=== GeeTest Slider Solver ===\n');
  
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    await page.goto('https://nopecha.com/captcha/geetest#slide', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Click verify
    console.log('Clicking verify...');
    await page.locator('[class*="geetest_btn_click"]').first().click();
    await page.waitForSelector('text="Slide to complete the puzzle"', { timeout: 10000 });
    await page.waitForTimeout(1500);
    
    // Get the background and slice images
    const bgElement = page.locator('[class*="geetest_bg"]').first();
    const sliceElement = page.locator('[class*="geetest_slice_bg"]').first();
    
    const bgBuffer = await bgElement.screenshot();
    const sliceBuffer = await sliceElement.screenshot();
    
    // Save for debugging
    fs.writeFileSync('/tmp/geetest-bg.png', bgBuffer);
    fs.writeFileSync('/tmp/geetest-slice.png', sliceBuffer);
    console.log('Images saved');
    
    // Find gap position
    console.log('\nFinding gap position...');
    const gapX = await findGapWithVision(
      bgBuffer.toString('base64'),
      sliceBuffer.toString('base64')
    );
    
    if (gapX === null) {
      console.log('Could not detect gap');
      return;
    }
    
    console.log(`Gap at x=${gapX}`);
    
    // Get slider button position
    const sliderBtn = page.locator('[class*="geetest_btn"]').first();
    const sliderBox = await sliderBtn.boundingBox();
    
    if (!sliderBox) {
      console.log('Could not find slider');
      return;
    }
    
    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;
    
    // The drag distance is approximately the gap position
    // Slider starts at ~0, needs to go to gapX
    const dragDistance = gapX;
    
    console.log(`\nDragging ${dragDistance}px...`);
    
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(50);
    
    // Human-like drag with slight variations
    const steps = 35;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = startX + dragDistance * eased;
      // Add slight wobble
      const wobbleY = (Math.random() - 0.5) * 2;
      const wobbleX = (Math.random() - 0.5) * 1;
      await page.mouse.move(x + wobbleX, startY + wobbleY);
      await page.waitForTimeout(8 + Math.random() * 12);
    }
    
    await page.waitForTimeout(100);
    await page.mouse.up();
    
    // Wait for result
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/geetest-result.png' });
    
    // Check success
    const pageText = await page.locator('body').textContent();
    if (pageText?.includes('success') || pageText?.includes('Success')) {
      console.log('\n✅ SOLVED!');
    } else {
      console.log('\n❌ Check result screenshot');
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/tmp/geetest-error.png' }).catch(() => {});
  }
  
  await page.close();
  await context.close();
}

main().catch(console.error);
