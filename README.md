# jevcaptcha

Local captcha solver using vision models + JEV (TypeSafe).

Solves captchas on your machine so the IP matches at submit time.

## Architecture

```
Image → Vision Model (describe tiles) → JEV (select matching) → Click
```

1. **Vision**: Cheap VLM (Qwen-2.5-VL) describes each tile as text
2. **JEV**: TypeSafe's decision model picks which tiles match the prompt
3. **Local**: Runs on user's machine, no IP mismatch issues

## Supported Types

- [x] Grid selection (hCaptcha, reCAPTCHA v2)
- [ ] Slider (GeeTest)
- [ ] Icon matching
- [ ] Text OCR

## Usage

```typescript
import { solveGrid, type SolverConfig, type GridChallenge } from 'jevcaptcha';

const config: SolverConfig = {
  vision: {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: 'qwen/qwen3.7-flash',  // cheap and supports vision
  },
};

const challenge: GridChallenge = {
  prompt: 'Select all images containing buses',
  imageBase64: '...', // base64 PNG of the grid
  rows: 3,
  cols: 3,
};

const solution = await solveGrid(challenge, config);
console.log('Click tiles:', solution.tiles);
// => [0, 8]
```

## Cost

Using qwen3.7-flash on OpenRouter:
- **Vision step**: ~$0.0001 per grid (describing 9 tiles)
- **Selection step**: ~$0.00005 per decision
- **Total**: ~$0.00015 per captcha solve

vs 2Captcha at ~$2-3 per 1000 = $0.002-0.003 per solve

## Testing

```bash
# Add a sample captcha screenshot to test/fixtures/sample_grid.png
npm test

# Test vision descriptions only
npm test -- --describe
```

## Environment

```bash
export OPENROUTER_API_KEY=...
```
