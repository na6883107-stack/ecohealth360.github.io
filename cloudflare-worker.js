const ALLOWED_ORIGINS = new Set([
  'https://na6883107-stack.github.io',
  'https://ecohealth360-github-io.na6883107.workers.dev'
]);
const MAX_QUESTION_LENGTH = 1500;
const SYSTEM_PROMPT = `أنت مساعد توعوي صحي عربي. لا تدّعِ أنك طبيب، ولا تؤكد تشخيص مرض أو تصف دواء أو جرعة أو خطة علاج. اشرح المعلومات العامة ببساطة وأمان، ووجّه المستخدم للطبيب أو الطوارئ عند الحاجة. لا تطلب بيانات شخصية أو معلومات حساسة.`;

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    }
  });
}

function getAiConfig(env) {
  const provider = String(env.AI_PROVIDER || '').trim().toLowerCase();
  if (provider === 'gemini' || (!provider && env.GEMINI_API_KEY)) {
    return {
      provider: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || 'gemini-2.5-flash'
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
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
    })
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('Gemini API returned HTTP', upstream.status, detail.slice(0, 1000));
    throw new Error(`GEMINI_HTTP_${upstream.status}`);
  }
  const result = await upstream.json();
  const answer = result?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('').trim();
  if (!answer) throw new Error('GEMINI_EMPTY_RESPONSE');
  return answer;
}

async function callOpenAI(question, model, apiKey) {
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    const detail = await upstream.text().catch(() => '');
    console.error('OpenAI API returned HTTP', upstream.status, detail.slice(0, 1000));
    throw new Error(`OPENAI_HTTP_${upstream.status}`);
  }
  const result = await upstream.json();
  const answer = result?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('OPENAI_EMPTY_RESPONSE');
  return answer;
}

function providerError(error, provider) {
  const message = String(error?.message || '');
  if (message.endsWith('_HTTP_400')) return 'إعدادات الطلب أو اسم الموديل غير مقبول. احذفي GEMINI_MODEL مؤقتًا أو اختاري موديلًا متاحًا لحسابك.';
  if (message.endsWith('_HTTP_401') || message.endsWith('_HTTP_403')) return 'مفتاح Gemini غير صالح أو غير مفعّل. أعيدي إضافة GEMINI_API_KEY كـ Secret في هذا الـ Worker.';
  if (message.endsWith('_HTTP_404')) return 'موديل Gemini المحدد غير موجود أو غير متاح. غيّري GEMINI_MODEL إلى موديل متاح لحسابك.';
  if (message.endsWith('_HTTP_429')) return 'تم بلوغ حد الاستخدام أو الحصة لدى مزود الذكاء الاصطناعي. تحققي من الحصة في Google AI Studio.';
  if (message.endsWith('_EMPTY_RESPONSE')) return 'مزود الذكاء الاصطناعي أعاد ردًا فارغًا. جرّبي سؤالًا آخر.';
  return `تعذر الاتصال بمزود ${provider}. راجعي سجلات Worker في Cloudflare.`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed', { status: 403 });
    const responseOrigin = origin || 'https://na6883107-stack.github.io';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': responseOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin'
        }
      });
    }

    // This Worker is an API backend; static website files are hosted on GitHub Pages.
    // Avoid env.ASSETS.fetch when no assets binding exists (which caused the TypeError in the screenshot).
    if (url.pathname !== '/api/health' && url.pathname !== '/api/health/check') {
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
      return jsonResponse({ error: 'Not found. Open the GitHub Pages website for the site UI.' }, 404, responseOrigin);
    }

    const ai = getAiConfig(env);
    if (url.pathname === '/api/health/check') {
      if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, responseOrigin);
      return jsonResponse({ worker: 'online', provider: ai.provider, configured: Boolean(ai.apiKey), model: ai.model }, 200, responseOrigin);
    }

    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, responseOrigin);
    if (!ai.apiKey) {
      return jsonResponse({ error: `مفتاح ${ai.provider === 'gemini' ? 'Gemini' : 'OpenAI'} غير مضبوط في إعدادات Worker.` }, 503, responseOrigin);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, responseOrigin); }
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) return jsonResponse({ error: 'Question is required' }, 400, responseOrigin);
    if (question.length > MAX_QUESTION_LENGTH) return jsonResponse({ error: 'Question is too long' }, 413, responseOrigin);

    try {
      const answer = ai.provider === 'gemini'
        ? await callGemini(question, ai.model, ai.apiKey)
        : await callOpenAI(question, ai.model, ai.apiKey);
      return jsonResponse({ answer }, 200, responseOrigin);
    } catch (error) {
      console.error('Assistant request failed:', error?.message || error);
      return jsonResponse({ error: providerError(error, ai.provider) }, 502, responseOrigin);
    }
  }
};
