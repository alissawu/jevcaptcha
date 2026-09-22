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
  jevApiKey: process.env.TYPESAFE_API_KEY!,
  vision: {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: 'qwen/qwen-2.5-vl-7b-instruct',
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
```

## Cost

- **Vision**: ~$0.001 per grid (Qwen-2.5-VL 7B on OpenRouter)
- **JEV**: ~$0.00004 per decision ($0.042/million tokens)
- **Total**: ~$0.001 per captcha solve

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
export TYPESAFE_API_KEY=...
export OPENROUTER_API_KEY=...
```
