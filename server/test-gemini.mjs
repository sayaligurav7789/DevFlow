
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  console.log('Sending request to Gemini 3.5 Flash...');

  const start = Date.now();

  try {
    const interaction = await ai.interactions.create({
      model: 'gemini-3.5-flash-lite',
      input: 'Reply with only: DevFlow AI working',
      generation_config: {
        max_output_tokens: 128,
        thinking_level: 'low',
      },
    });

    console.log('\nGemini response:');
    console.log(interaction.steps?.at(-1));

    console.log('\nTime taken:', (Date.now() - start) / 1000, 'seconds');
  } catch (error) {
    console.error('\nGemini SDK error:', error);
  }
}

main();
