const ALLOWED_ORIGINS = new Set([
  'https://na6883107-stack.github.io',
  'https://ecohealth360-github-io.na6883107.workers.dev'
]);
const MAX_QUESTION_LENGTH = 1500;
const SYSTEM_PROMPT = `أنت مساعد توعوي صحي عربي. لا تدّعِ أنك طبيب، ولا تؤكد تشخيص مرض أو تصف دواء أو جرعة أو خطة علاج. اشرح المعلومات العامة بشكل بسيط وآمن، ووجه المستخدم إلى الطبيب المختص أو الطوارئ عند الحاجة. لا تطلب بيانات شخصية أو معلومات حساسة. إذا ظهرت علامات طوارئ مثل صعوبة تنفس حادة، فقدان وعي، دم في البراز، ألم صدر شديد، تشنجات، نزف شديد، أو أعراض خطيرة في الطفل، أ urge إلى طلب العناية الطبية الفورية.`;

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    }
  });
}

function getAiConfig(env) {
  const provider = String(env.AI_PROVIDER || '').trim().toLowerCase();

  if (provider === 'gemini' || env.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || 'gemini-3.8-flash'
    };
  }

  return {
    provider: 'openai',
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

async function callGemini(question, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600
      }
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    throw new Error(`Gemini request failed: ${text}`);
  }

  const result = await upstream.json();
  const answer = result?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || '')
    .join('')
    .trim();

  if (!answer) {
    throw new Error('No answer was returned');
  }

  return answer;
}

async function callOpenAI(question, model, apiKey) {
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question }
      ]
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    throw new Error(`OpenAI request failed: ${text}`);
  }

  const result = await upstream.json();
  const answer = result?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('No answer was returned');
  }

  return answer;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/health') {
      return env.ASSETS.fetch(request);
    }

    const origin = request.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const responseOrigin = origin || 'https://na6883107-stack.github.io';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': responseOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin'
        }
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, responseOrigin);
    }

    const ai = getAiConfig(env);
    if (!ai.apiKey) {
      return jsonResponse({ error: 'Assistant service is not configured. Add GEMINI_API_KEY or OPENAI_API_KEY in Cloudflare Worker secrets.' }, 503, responseOrigin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, responseOrigin);
    }

    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return jsonResponse({ error: 'Question is required' }, 400, responseOrigin);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: 'Question is too long' }, 413, responseOrigin);
    }

    try {
      const answer = ai.provider === 'gemini'
        ? await callGemini(question, ai.model, ai.apiKey)
        : await callOpenAI(question, ai.model, ai.apiKey);

      return jsonResponse({ answer }, 200, responseOrigin);
    } catch (error) {
      console.error('Assistant error:', error);
      return jsonResponse({ error: 'Assistant service is temporarily unavailable' }, 502, responseOrigin);
    }
  }
};
