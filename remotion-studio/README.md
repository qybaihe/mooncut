# Talking-head Remotion Studio

Run the interactive timeline editor:

```bash
npm install
npm run studio
```

Render the example:

```bash
npm run render
```

The editable semantic video timeline lives in `src/timeline.ts`. Your ASR/LLM service should output equivalent JSON: each beat decides its timing, text, speaker framing, visual type, and keywords.

This project includes a real 25.8-second Beijing "Moonshot Plan | Physical AI" hackathon talking-head test. It scrolls the original long-form WeChat poster and real captures from OpenAI's July 9 GPT-5.6 launch page, including the official frontend-design section.

Generate word-level subtitles through the local Hybrid Subtitle API:

```bash
npm run transcribe -- public/media/talking-head.mp4
```

Environment overrides are available through `SUBTITLE_API_URL` and `SUBTITLE_API_KEY`. The generated `src/generated-subtitles.json` drives word timing, spoken-word color, and emphasized-word scaling in Remotion.

To use a real speaker recording, place it in `public/media/talking-head.mp4`, then pass it to the composition:

```bash
npx remotion render src/index.ts TalkingHeadDemo out/final.mp4 --props='{"talkingHeadSrc":"media/talking-head.mp4"}'
```
