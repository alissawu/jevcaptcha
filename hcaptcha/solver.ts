import { chromium, BrowserContext, Frame } from "patchright";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";

const typesafe = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY! });

async function describeImage(b64: string): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen/qwen3-vl-8b-instruct",
      max_tokens: 50,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: b64 } },
          { type: "text", text: "What object or food is shown? 3-5 words only." }
        ]
      }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  let content = data.choices?.[0]?.message?.content ?? "unknown";
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function classifyWithJev(desc: string, prompt: string): Promise<{ isMatch: boolean; conf: number }> {
  const result = await typesafe.systemOne({
    state: `Image: "${desc}". Prompt: "${prompt}"`,
    questions: {
      match: choice("Match?", { yes: "Yes matches", no: "No" })
    }
  });
  const yes = result.answers.match.probabilities?.yes ?? 0;
  return { isMatch: yes > 0.5, conf: yes };
}

async function fetchTileImage(url: string, cookies: string, referrer: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'Cookie': cookies,
        'Referer': referrer,
        'Origin': 'https://newassets.hcaptcha.com'
      }
    });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

async function extractChallenge(context: BrowserContext, challengeFrame: Frame) {
  // Get cookies
  const allCookies = await context.cookies();
  const cookieHeader = allCookies
    .filter(c => c.domain.includes('hcaptcha') || c.domain.includes('imgs'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  
  const referrer = challengeFrame.url();

  // Get prompt
  const prompt = await challengeFrame.$eval('h2.prompt-text', el => el.textContent?.trim() ?? '');

  // Get tile URLs
  const tileUrls = await challengeFrame.evaluate(() => {
    const urls: string[] = [];
    document.querySelectorAll('.task-image .image').forEach(el => {
      const style = (el as HTMLElement).getAttribute('style') || '';
      const match = style.match(/url\("?([^"]+)"?\)/);
      if (match) urls.push(match[1]);
    });
    return urls;
  });

  return { prompt, tileUrls, cookieHeader, referrer };
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Loading...");
  await page.goto("https://nopecha.com/demo/hcaptcha", { timeout: 20000 });

  const checkboxFrame = page.frameLocator('iframe[title*="checkbox"]');
  await checkboxFrame.locator('#checkbox').click({ timeout: 5000 });
  console.log("Clicked checkbox");
  await page.waitForTimeout(4000);

  const frames = page.frames();
  const cf = frames.find(f => f.url().includes('frame=challenge'));
  if (!cf) { console.log("No challenge"); await browser.close(); return; }

  // Extract challenge data
  const { prompt, tileUrls, cookieHeader, referrer } = await extractChallenge(context, cf);
  console.log(`\nPrompt: "${prompt}"`);
  console.log(`Tiles: ${tileUrls.length}\n`);

  // Fetch all tiles in parallel
  console.log("Fetching tiles...");
  const t0 = Date.now();
  const images = await Promise.all(
    tileUrls.map(url => fetchTileImage(url, cookieHeader, referrer))
  );
  console.log(`Fetched ${images.filter(Boolean).length} images in ${Date.now() - t0}ms\n`);

  await browser.close();

  // Describe all images in parallel
  console.log("Describing images...");
  const t1 = Date.now();
  const descriptions = await Promise.all(
    images.map(async (img, i) => {
      if (!img) return { index: i, desc: null };
      try {
        const desc = await describeImage(img);
        return { index: i, desc };
      } catch (e) {
        return { index: i, desc: null };
      }
    })
  );
  console.log(`Described in ${Date.now() - t1}ms\n`);

  // Classify with Jev (parallel)
  console.log("Classifying...");
  const t2 = Date.now();
  const results = await Promise.all(
    descriptions.map(async ({ index, desc }) => {
      if (!desc) return { index, desc: 'error', isMatch: false, conf: 0 };
      const { isMatch, conf } = await classifyWithJev(desc, prompt);
      return { index, desc, isMatch, conf };
    })
  );
  console.log(`Classified in ${Date.now() - t2}ms\n`);

  // Print results
  console.log("=== Results ===\n");
  for (const r of results) {
    console.log(`Tile ${r.index}: "${r.desc}" → ${r.isMatch ? "✓ MATCH" : "✗"} (${(r.conf * 100).toFixed(0)}%)`);
  }

  const matches = results.filter(r => r.isMatch);
  console.log(`\n=== SELECT: ${matches.map(r => r.index).join(', ')} ===`);
  console.log(`Total time: ${Date.now() - t0}ms`);
}

main().catch(console.error);
