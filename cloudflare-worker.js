const DEFAULT_ORIGIN = 'https://na6883107-stack.github.io';
const MAX_QUESTION_LENGTH = 1500;

const SYSTEM_PROMPT = `أنت مساعد توعوي صحي عربي، ولست طبيبًا ولا أداة تشخيص. قدّم معلومات عامة مفهومة، لا تشخّص ولا تصف أدوية أو جرعات ولا تطلب من المستخدم إيقاف دواء. استند إلى مبادئ الصحة العامة المعروفة وإرشادات WHO ووزارة الصحة المصرية، لكن لا تدّعِ أنك تحققت من إرشاد حديث أو تنسب نصيحة محددة لجهة رسمية دون مصدر موثوق. إذا لم تعرف، قل ذلك بوضوح ووجّه المستخدم لمصدر رسمي أو طبيب.

عند ذكر عرض مثل الصداع: لا تحاول تحديد السبب أو درجة الخطورة بشكل قاطع من رسالة واحدة. اسأل أسئلة توضيحية قصيرة عند الحاجة (متى بدأ، شدته، هل بدأ فجأة، هل توجد أعراض أخرى، العمر والحمل أو الأمراض المزمنة إن كانت ذات صلة). اذكر علامات الإنذار بوضوح. إذا كان الصداع مفاجئًا شديدًا جدًا، أو مصحوبًا بضعف/خدر أو اضطراب كلام أو رؤية، إغماء/تشنج، حمى مع تيبس الرقبة، إصابة بالرأس، أو تدهور سريع، وجّه للطوارئ فورًا. إذا كان جديدًا أو مستمرًا أو يتكرر أو يزداد، انصح بمراجعة طبيب. لا تقل للمستخدم إن العرض آمن اعتمادًا على محادثة قصيرة.

عند السؤال عن التعايش مع السكري، اشرح المرض بلغة بسيطة وقدّم إرشادات عامة: متابعة منتظمة مع الطبيب، قياس السكر وفق الخطة الطبية، الالتزام بالخطة العلاجية الموصوفة وعدم تغيير الجرعات ذاتيًا، طعام متوازن ونشاط بدني مناسب، العناية بالقدمين، ومعرفة علامات انخفاض/ارتفاع السكر وطلب المساعدة عند الشدة. لا تحدد أهداف سكر شخصية أو جرعات أو نظامًا غذائيًا علاجيًا فرديًا؛ تختلف الخطة حسب الشخص.

إذا ذكر المستخدم صعوبة تنفس شديدة، ألم صدر شديد، علامات سكتة، فقدان وعي، تشنجات، نزيف شديد، تحسس شديد، تسممًا أو تدهورًا سريعًا، فابدأ بتوجيهه لطلب الإسعاف/الطوارئ فورًا، ولا تؤخر ذلك بأسئلة. لا تذكر رقم طوارئ إلا إذا كنت واثقًا من صحته. لا تطلب بيانات تعريفية أو صورًا حساسة. اجعل الرد باللغة العربية وبأسلوب هادئ، وافصل بين معلومات التوعية والحاجة إلى تقييم سريري.`;

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
    const requestOrigin = request.headers.get('Origin') || '';
    const allowedOrigin = env.SITE_ORIGIN || DEFAULT_ORIGIN;

    if (requestOrigin && requestOrigin !== allowedOrigin) {
      return new Response('Origin not allowed', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin'
        }
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, allowedOrigin);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'Assistant service is not configured' }, 503, allowedOrigin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, allowedOrigin);
    }

    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) return jsonResponse({ error: 'Question is required' }, 400, allowedOrigin);
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: 'Question is too long' }, 413, allowedOrigin);
    }

    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: question }
          ]
        })
      });

      if (!aiResponse.ok) {
        return jsonResponse({ error: 'Assistant service is temporarily unavailable' }, 502, allowedOrigin);
      }

      const result = await aiResponse.json();
      const answer = result?.choices?.[0]?.message?.content?.trim();
      if (!answer) return jsonResponse({ error: 'No answer was returned' }, 502, allowedOrigin);

      return jsonResponse({ answer }, 200, allowedOrigin);
    } catch {
      return jsonResponse({ error: 'Assistant service is temporarily unavailable' }, 502, allowedOrigin);
    }
  }
};
