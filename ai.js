// ai.js
// 提供圖片分析以自動產生投票主題與選項（支援 Gemini 與 NVIDIA NIM）

/**
 * 從 base64 字串中解析 mimeType 與純 base64 資料
 * @param {string} dataUrl 
 * @returns {{ mimeType: string, base64: string }}
 */
function parseBase64Data(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('請提供有效的圖片資料');
  }

  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/s);
  if (match) {
    return { mimeType: match[1].toLowerCase(), base64: match[2].trim() };
  }

  // 若僅傳入純 base64，預設為 image/jpeg
  return { mimeType: 'image/jpeg', base64: dataUrl.trim() };
}

/**
 * 建立給 AI 的結構化提示詞
 * @param {string} [userPrompt] 使用者自訂補充提示
 * @returns {string}
 */
function buildPrompt(userPrompt = '') {
  const extraPrompt = userPrompt && userPrompt.trim()
    ? `\n使用者額外補充說明：${userPrompt.trim()}`
    : '';

  return `你是一個專業的投票助理。請仔細分析這張圖片（例如菜單、活動海報、選項清單、宣傳簡報等），從中提取出適合發起投票的「投票主題」與「所有可選項目清單」。
${extraPrompt}

【輸出格式嚴格規範】
請務必且只能回傳合法的標準 JSON 字串，絕對不要包含任何 Markdown 標記（例如不要加 \`\`\`json 或 \`\`\`）、也不要包含任何前後問候或解釋文字。
JSON 格式必須完全符合以下結構：
{
  "title": "投票主題名稱（例如：週五午餐訂購調查、最佳社團人氣獎選拔）",
  "options": [
    "選項1",
    "選項2",
    "選項3"
  ]
}

【注意事項】
1. 請一律使用台灣習慣的繁體中文（zh-TW）。
2. 選項必須具體明確、去除重複項目，且至少需要有 2 個選項。
3. 只能回傳單一 JSON 物件，不能有任何其他多餘字元。`;
}

/**
 * 清理並解析 AI 回傳的 JSON 文字
 * @param {string} text 
 * @returns {{ title: string, options: string[] }}
 */
function extractAndParseJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI 未回傳任何有效內容');
  }

  let cleaned = text.trim();

  // 去除可能的 ```json 與 ``` 包裹
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 若仍有非 JSON 文字，嘗試用正規表達式截取最外層 JSON 物件
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('AI 回傳的內容不是合法的 JSON 格式，無法解析');
  }

  const title = (parsed.title || '').toString().trim();
  const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
  const options = rawOptions
    .map(opt => (opt !== null && opt !== undefined ? String(opt).trim() : ''))
    .filter(Boolean);

  if (!title) {
    throw new Error('AI 分析未能產生有效的投票主題');
  }

  if (options.length < 2) {
    throw new Error('AI 辨識出的選項少於 2 個（投票至少需要 2 個選項），請嘗試補充提示或換一張更清晰的圖片');
  }

  return { title, options };
}

/**
 * 使用 Google Gemini 分析圖片
 */
async function extractWithGemini(mimeType, base64Data, promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('尚未設定 Gemini API 金鑰，請聯絡管理者設定 API 金鑰');
  }

  const model = 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim()
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(35000)
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError') {
      throw new Error('Gemini API 服務呼叫逾時，請稍後再試');
    }
    throw new Error(`連線至 Gemini API 失敗：${fetchErr.message}`);
  }

  const data = await res.json();
  if (!res.ok) {
    const errorMsg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini API 回傳錯誤：${errorMsg}`);
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini 未回傳任何文字內容，可能是圖片無法辨識或觸發安全性過濾');
  }

  return extractAndParseJson(rawText);
}

/**
 * 使用 NVIDIA NIM (OpenAI 相容) 分析圖片
 */
async function extractWithNvidia(mimeType, base64Data, promptText) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('尚未設定 NVIDIA API 金鑰，請聯絡管理者設定 API 金鑰');
  }

  const model = 'meta/llama-3.2-90b-vision-instruct';
  const url = 'https://integrate.api.nvidia.com/v1/chat/completions';

  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Data}`
            }
          }
        ]
      }
    ],
    temperature: 0.2,
    max_tokens: 1500
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(45000)
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError') {
      throw new Error('NVIDIA API 服務呼叫逾時，請稍後再試');
    }
    throw new Error(`連線至 NVIDIA API 失敗：${fetchErr.message}`);
  }

  const data = await res.json();
  if (!res.ok) {
    const errorMsg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`NVIDIA API 回傳錯誤：${errorMsg}`);
  }

  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('NVIDIA NIM 未回傳任何文字內容');
  }

  return extractAndParseJson(rawText);
}

/**
 * 核心分析入口函式
 * @param {Object} params
 * @param {string} params.image Base64 格式圖片
 * @param {string} params.provider "gemini" | "nvidia"
 * @param {string} [params.prompt] 使用者選填提示
 * @returns {Promise<{ title: string, options: string[] }>}
 */
async function extractPollFromImage({ image, provider = 'gemini', prompt = '' }) {
  if (!image) {
    throw new Error('請上傳要辨識的圖片');
  }

  const { mimeType, base64 } = parseBase64Data(image);

  // 驗證圖片格式
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new Error('僅支援 JPG、PNG 或 WEBP 格式的圖片');
  }

  // 大小粗估限制 (10MB base64 約 13.7MB 字串)
  if (base64.length > 14 * 1024 * 1024) {
    throw new Error('圖片大小超過限制，請上傳小於 10MB 的圖片');
  }

  const promptText = buildPrompt(prompt);
  const normalizedProvider = (provider || '').toLowerCase().trim();

  if (normalizedProvider === 'gemini') {
    return await extractWithGemini(mimeType, base64, promptText);
  } else if (normalizedProvider === 'nvidia') {
    return await extractWithNvidia(mimeType, base64, promptText);
  } else {
    throw new Error(`不支援的 AI 供應商：${provider}，請選擇 Gemini 或 NVIDIA`);
  }
}

module.exports = {
  extractPollFromImage,
  parseBase64Data,
  extractAndParseJson
};
