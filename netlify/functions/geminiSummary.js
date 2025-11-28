/**
 * Gemini AI 요약분석 Netlify Function
 * - 환경변수에서 API 키를 안전하게 사용
 * - 브라우저에서 직접 Gemini API 호출하지 않음
 */

exports.handler = async function(event, context) {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // POST만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // 환경변수에서 API 키 가져오기
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' })
      };
    }

    // 요청 본문 파싱
    const { companyData, programs } = JSON.parse(event.body || '{}');

    if (!companyData || !programs || programs.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '기업 정보와 프로그램 목록이 필요합니다.' })
      };
    }

    // 프롬프트 생성
    const prompt = `
당신은 대한민국 정부 지원사업 전문 컨설턴트입니다. 기업에게 실질적으로 도움이 되는 분석을 제공해야 합니다.

## 분석 대상 기업 정보
- 기업명: ${companyData.companyName}
- 업종코드(KSIC): ${companyData.ksicCode}
- 기업규모: ${companyData.companySize}
- 직원수: ${companyData.employeesTotal}명
- 소재지: ${companyData.locationSido} ${companyData.locationSigungu || ''}
- 수도권여부: ${companyData.capitalArea === 'Y' ? '수도권' : '비수도권'}
- 매출액: ${companyData.revenueRecent ? (companyData.revenueRecent / 100000000).toFixed(1) + '억원' : '미입력'}

## 상위 10개 추천 지원사업

${programs.map((p, i) => `
[${i + 1}번] ${p.name}
- 주관기관: ${p.organization || '미상'}
- 지원분야: ${p.category || '기타'}
- 지원대상: ${p.target || '미상'}
- 지원내용: ${p.description || '상세내용 확인 필요'}
- 신청기간: ${p.applicationPeriod || '상시'}
- 현재매칭점수: ${p.matchScore}점
- 매칭이유: ${p.matchReasons?.join(', ') || '기본조건 충족'}
`).join('\n')}

## 요청사항
각 지원사업에 대해 해당 기업이 이해하기 쉽도록 다음 정보를 JSON 배열로 제공해주세요:

1. summary: 이 지원사업이 무엇인지, 어떤 혜택을 받을 수 있는지 80자 이내로 구체적으로 설명
2. recommendation: 왜 이 기업에 적합한지, 신청하면 어떤 이점이 있는지 50자 이내로 설명

[
  {
    "index": 0,
    "summary": "지원사업 내용과 혜택을 구체적으로 80자 이내로",
    "recommendation": "이 기업에 적합한 이유를 50자 이내로"
  }
]

반드시 유효한 JSON 배열만 출력하세요. 마크다운이나 다른 텍스트 없이 순수 JSON만 응답하세요.
`;

    // Gemini API 호출
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API 오류:', response.status, errorText);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: `Gemini API 오류: ${response.status}` })
      };
    }

    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // JSON 추출
    let jsonText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let summaryResults;
    try {
      summaryResults = JSON.parse(jsonText);
    } catch (e) {
      console.error('JSON 파싱 오류:', e);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'AI 응답 파싱 실패', rawText: aiText })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, results: summaryResults })
    };

  } catch (error) {
    console.error('서버 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
