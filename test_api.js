import 'dotenv/config';

const API_KEY = process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
const MODEL_NAME = 'glm-4.7';

console.log('Testing OpenAI API...');
console.log('API Key:', API_KEY ? 'Set' : 'Not set');
console.log('Base URL:', BASE_URL);
console.log('Model:', MODEL_NAME);

async function testAPI() {
  const prompt = '以下はDiscordチャンネルでの対話ログです。このログを分析して、JSON形式で日報を生成してください。\n\n対話ログ:\nテストメッセージ\n\nJSON形式で出力してください（コードブロックなし）: {\n  "date": "2026-02-20",\n  "channelSummary": "テスト要約",\n  "users": {}\n}';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

  try {
    console.log('Sending request...');
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates daily reports from Discord conversations. You accept input in Japanese and output JSON.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1024
      })
    });

    clearTimeout(timeoutId);

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return;
    }

    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.choices && data.choices[0]) {
      const content = data.choices[0].message.content;
      console.log('\n--- Content ---');
      console.log(content);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error:', error.message);
  }
}

testAPI();
