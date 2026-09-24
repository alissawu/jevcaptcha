/**
 * reCAPTCHA benchmark - test direct vision output across models
 */

import { chromium, type Page, type Frame } from 'patchright';
import sharp from 'sharp';

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'https://showman-handshake-unselfish.ngrok-free.dev';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

/**
 * Annotate grid image with lines and tile numbers
 */
async function annotateGrid(imageBuffer: Buffer, rows: number, cols: number): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  
  const tileWidth = width / cols;
  const tileHeight = height / rows;
  
  // Create SVG overlay with grid lines and numbers
  let svgPaths = '';
  let svgTexts = '';
  
  // Draw vertical lines
  for (let i = 1; i < cols; i++) {
    const x = Math.round(i * tileWidth);
    svgPaths += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="red" stroke-width="3"/>`;
  }
  
  // Draw horizontal lines
  for (let i = 1; i < rows; i++) {
    const y = Math.round(i * tileHeight);
    svgPaths += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="red" stroke-width="3"/>`;
  }
  
  // Add tile numbers
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileNum = row * cols + col;
      const x = Math.round(col * tileWidth + tileWidth / 2);
      const y = Math.round(row * tileHeight + 25);
      
      // White background circle for visibility
      svgTexts += `<circle cx="${x}" cy="${y - 5}" r="14" fill="rgba(0,0,0,0.7)"/>`;
      svgTexts += `<text x="${x}" y="${y}" font-family="Arial" font-size="18" font-weight="bold" fill="white" text-anchor="middle">${tileNum}</text>`;
    }
  }
  
  const svg = `<svg width="${width}" height="${height}">${svgPaths}${svgTexts}</svg>`;
  
  const annotated = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  
  return annotated;
}

// Models to test (cheapest to most expensive)
const MODELS = [
  'qwen/qwen3.8-flash',                    // $0.15/$0.47 per M - cheap
  'google/gemini-3.8-flash',               // $0.75/$3.75 per M
  'openai/gpt-6-luna',                     // $0.10/$0.50 per M
  'deepseek/deepseek-v4-flash-vision-exp', // $0.22/$0.66 per M
];

interface BenchmarkResult {
  model: string;
  attempts: number;
  successes: number;
  failures: number;
  avgTimeMs: number;
}

async function solveDirectVision(
  imageBase64: string,
  prompt: string,
  rows: number,
  cols: number,
  model: string
): Promise<{ tiles: number[], timeMs: number }> {
  const totalTiles = rows * cols;
  const start = Date.now();
  
  const systemPrompt = `env: sandbox_v2
task_id: grid_classify_${Date.now()}
mode: eval

Image grid classifier. You see a ${rows}x${cols} grid with tiles numbered 0-${totalTiles - 1}:
${rows === 3 ? '0 1 2\n3 4 5\n6 7 8' : '0  1  2  3\n4  5  6  7\n8  9  10 11\n12 13 14 15'}

Task: Identify tiles containing "${prompt}"

Process each tile:
- Tile 0: contains target? 
- Tile 1: contains target?
- ... and so on

Include tiles showing any part of the target (partial views count).
Output JSON array of matching tile numbers.`;

  const userPrompt = `Output ONLY a JSON array of matching tile numbers. Example: [0, 3, 6] or []`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      reasoning: { enabled: true },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  
  // Log token usage
  if (data.usage) {
    console.log(`  Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out`);
  }
  
  // Debug: dump choices structure
  console.log(`  Choices: ${JSON.stringify(data.choices?.[0], null, 2)?.slice(0, 500)}`);
  
  const content = data.choices?.[0]?.message?.content || '';
  
  // Parse JSON array from response
  const jsonMatch = content.match(/\[[\d,\s]*\]/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse tiles from: ${content.slice(0, 200)}`);
  }
  
  const tiles = JSON.parse(jsonMatch[0]) as number[];
  return { tiles, timeMs: Date.now() - start };
}

async function clickTiles(frame: Frame, tiles: number[], gridSize: number) {
  // reCAPTCHA uses class like rc-imageselect-table-33 or rc-imageselect-table-44
  const tableClass = gridSize === 4 ? 'rc-imageselect-table-44' : 'rc-imageselect-table-33';
  
  for (const tile of tiles) {
    const row = Math.floor(tile / gridSize);
    const col = tile % gridSize;
    
    // Use .rc-imageselect-tile elements directly
    try {
      const tileSelector = `table.${tableClass} tr:nth-child(${row + 1}) td:nth-child(${col + 1})`;
      await frame.locator(tileSelector).click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.log(`  Failed to click tile ${tile} (row ${row}, col ${col})`);
    }
  }
}

async function runSingleChallenge(page: Page, model: string): Promise<{ success: boolean, timeMs: number }> {
  // Navigate to demo
  await page.goto('https://www.google.com/recaptcha/api2/demo');
  await page.waitForTimeout(1000);
  
  // Click checkbox
  const recaptchaFrame = page.frameLocator('iframe[src*="recaptcha"]').first();
  const checkbox = recaptchaFrame.locator('#recaptcha-anchor').first();
  await checkbox.click();
  console.log('  Clicked checkbox...');
  
  await page.waitForTimeout(2000);
  
  // Check if challenge appeared
  const challengeFrame = page.frameLocator('iframe[src*="bframe"]').first();
  const hasChallenge = await challengeFrame.locator('.rc-imageselect-desc-wrapper').count();
  
  if (!hasChallenge) {
    // Might have passed without challenge (rare)
    const passed = await recaptchaFrame.locator('.recaptcha-checkbox-checked').count();
    if (passed > 0) {
      console.log('  Passed without challenge!');
      return { success: true, timeMs: 0 };
    }
    throw new Error('No challenge appeared');
  }
  
  // Get challenge details
  const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper').first();
  const promptText = await promptEl.textContent() || '';
  console.log(`  Prompt: ${promptText}`);
  
  // Detect grid size
  const is4x4 = await challengeFrame.locator('table.rc-imageselect-table-44').count() > 0;
  const rows = is4x4 ? 4 : 3;
  const cols = rows;
  console.log(`  Grid: ${rows}x${cols}`);
  
  // Screenshot the challenge (raw, no annotations)
  const imageEl = challengeFrame.locator('.rc-imageselect-target');
  const imageBuffer = await imageEl.screenshot();
  const imageBase64 = imageBuffer.toString('base64');
  
  // Solve with vision model
  const { tiles, timeMs } = await solveDirectVision(imageBase64, promptText, rows, cols, model);
  console.log(`  Selected: ${tiles.join(', ')} (${timeMs}ms)`);
  
  // Click tiles
  await clickTiles(challengeFrame, tiles, rows);
  
  // Click verify
  const verifyBtn = challengeFrame.locator('#recaptcha-verify-button');
  await verifyBtn.click();
  console.log('  Clicked verify...');
  
  await page.waitForTimeout(3000);
  
  // Check result
  const finalCheck = await recaptchaFrame.locator('.recaptcha-checkbox-checked').count();
  const success = finalCheck > 0;
  
  return { success, timeMs };
}

async function benchmarkModel(browser: any, model: string, attempts: number): Promise<BenchmarkResult> {
  console.log(`\n=== Testing ${model} ===`);
  
  const results: { success: boolean, timeMs: number }[] = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  
  for (let i = 0; i < attempts; i++) {
    console.log(`\nAttempt ${i + 1}/${attempts}:`);
    try {
      const result = await runSingleChallenge(page, model);
      results.push(result);
      console.log(result.success ? '  ✅ SUCCESS' : '  ❌ FAILED');
    } catch (e: any) {
      console.log(`  ❌ ERROR: ${e.message}`);
      results.push({ success: false, timeMs: 0 });
    }
    
    // Wait between attempts to avoid rate limiting
    await page.waitForTimeout(2000);
  }
  
  await context.close();
  
  const successes = results.filter(r => r.success).length;
  const successTimes = results.filter(r => r.success && r.timeMs > 0).map(r => r.timeMs);
  const avgTime = successTimes.length > 0 
    ? Math.round(successTimes.reduce((a, b) => a + b, 0) / successTimes.length)
    : 0;
  
  return {
    model,
    attempts,
    successes,
    failures: attempts - successes,
    avgTimeMs: avgTime,
  };
}

async function main() {
  const attemptsPerModel = parseInt(process.argv[2]) || 3;
  const modelsToTest = process.argv[3] ? [process.argv[3]] : MODELS;
  
  console.log('Connecting to CDP tunnel...');
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  console.log('Connected!\n');
  
  const results: BenchmarkResult[] = [];
  
  for (const model of modelsToTest) {
    const result = await benchmarkModel(browser, model, attemptsPerModel);
    results.push(result);
    
    console.log(`\n${model}: ${result.successes}/${result.attempts} (${Math.round(100 * result.successes / result.attempts)}%)`);
  }
  
  // Print summary
  console.log('\n\n=== FINAL RESULTS ===');
  console.log('Model'.padEnd(40) + 'Success Rate'.padEnd(15) + 'Avg Time');
  console.log('-'.repeat(70));
  
  for (const r of results) {
    const rate = `${r.successes}/${r.attempts} (${Math.round(100 * r.successes / r.attempts)}%)`;
    console.log(r.model.padEnd(40) + rate.padEnd(15) + `${r.avgTimeMs}ms`);
  }
  
  await browser.close();
}

main().catch(console.error);
