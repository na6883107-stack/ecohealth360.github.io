const ALLOWED_ORIGINS = new Set([
  'https://na6883107-stack.github.io',
  'https://ecohealth360-github-io.na6883107.workers.dev'
]);
const MAX_QUESTION_LENGTH = 1500;
const SYSTEM_PROMPT = `أنت مساعد توعوي صحي عربي. لا تدّعِ أنك طبيب، ولا تؤكد تشخيص مرض أو تصف دواء أو جرعة أو خطة علاج. اشرح باختصار الاحتمالات العامة ذات الصلة بالأعراض فقط بصيغة غير جازمة، ووضح أن أسبابًا مختلفة قد تعطي أعراضًا متشابهة. قدّم تقييمًا حذرًا لمستوى الاستعجال: طوارئ الآن، تواصل طبي قريب، أو متابعة عامة؛ لا تقلل من الأعراض ولا تضمن السلامة. إذا ذكر المستخدم صعوبة شديدة في التنفس، ألمًا شديدًا بالصدر، علامات سكتة (ضعف مفاجئ بجهة أو اضطراب كلام)، فقدان وعي، تشنجًا، نزيفًا شديدًا، حساسية شديدة، تسممًا، أو تدهورًا حادًا، قل بوضوح أن يتصل بالطوارئ المحلية أو يذهب للطوارئ فورًا ولا ينتظر ردًا آخر. للأطفال والحوامل وكبار السن وذوي الأمراض المزمنة، وجّههم لطلب تقييم مهني مبكرًا. لا تطلب الاسم أو العنوان أو رقم الهاتف أو أي بيانات تعريفية. يمكنك ذكر نصائح عامة منخفضة المخاطر للتعايش مع حالة مشخصة، وشجّع المتابعة مع الطبيب وعدم إيقاف العلاج الموصوف. اكتب بالعربية السهلة، مع سؤال توضيحي عند الحاجة، واذكر أن هذا ليس تشخيصًا وأن التقييم يحتاج مختصًا.`;

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
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, responseOrigin);
    if (!env.OPENAI_API_KEY) return jsonResponse({ error: 'Assistant service is not configured' }, 503, responseOrigin);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, responseOrigin); }
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) return jsonResponse({ error: 'Question is required' }, 400, responseOrigin);
    if (question.length > MAX_QUESTION_LENGTH) return jsonResponse({ error: 'Question is too long' }, 413, responseOrigin);

    try {
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 600,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: question }
          ]
        })
      });
      if (!upstream.ok) return jsonResponse({ error: 'Assistant service is temporarily unavailable' }, 502, responseOrigin);
      const result = await upstream.json();
      const answer = result?.choices?.[0]?.message?.content?.trim();
      if (!answer) return jsonResponse({ error: 'No answer was returned' }, 502, responseOrigin);
      return jsonResponse({ answer }, 200, responseOrigin);
    } catch {
      return jsonResponse({ error: 'Assistant service is temporarily unavailable' }, 502, responseOrigin);
    }
  }
};
