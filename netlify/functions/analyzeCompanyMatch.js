/**
 * Gemini AI 기업 매칭 분석
 * - 기업 정보와 공고 매칭
 * - 점수 계산 및 순위 부여
 */

const fetch = require('node-fetch');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { companyData, programs } = JSON.parse(event.body || '{}');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    console.log(`🤖 AI 매칭 분석 시작: ${programs.length}개 프로그램`);

    const prompt = `
당신은 한국의 정부지원사업 전문 컨설턴트입니다.
다음 기업 정보를 분석하고, 제공된 지원사업 목록에서 가장 적합한 사업을 추천하세요.

# 기업 정보
\`\`\`json
{
  "기업명": "${companyData.companyName}",
  "업력": ${companyData.businessAge}년,
  "직원수": ${companyData.employees}명,
  "연매출": ${(companyData.revenue / 100000000).toFixed(0)}억원,
  "지역": "${companyData.region}",
  "업종": "${companyData.industry}",
  "기업유형": "${companyData.companyType}",
  "인증": {
    "벤처기업": ${companyData.hasVenture},
    "이노비즈": ${companyData.hasInnobiz},
    "메인비즈": ${companyData.hasMainbiz}
  },
  "특허보유": ${companyData.patentCount}건,
  "R&D투자비율": ${companyData.rdRatio}%,
  "청년고용비율": ${companyData.youthRatio}%,
  "수출기업": ${companyData.isExporting},
  "R&D부서": ${companyData.hasRnD}
}
\`\`\`

# 지원사업 목록 (${programs.length}개)
\`\`\`json
${JSON.stringify(programs.slice(0, 100).map(p => ({
  id: p.id,
  name: p.name,
  organization: p.organization,
  category: p.category,
  target: p.target,
  description: p.description?.substring(0, 300),
  period: p.reqstPeriod,
  hashTags: p.hashTags
})), null, 2)}
\`\`\`

# 분석 요청

각 지원사업에 대해 다음을 분석하세요:

1. **매칭 점수** (0-100점)
   - 자격요건 충족도
   - 지역/업종/규모 적합도
   - 인증/특허/R&D 우대 해당
   - 사업 목적과 기업 특성 일치도

2. **매칭 근거** (3-5개 핵심 이유)

3. **강점** (기업이 높은 점수를 받을 요소)

4. **약점** (보완이 필요한 부분)

5. **추천 우선순위**

# 출력 형식

상위 50개만 JSON 배열로 반환하세요:

\`\`\`json
[
  {
    "id": "bizinfo-xxx",
    "matchScore": 85,
    "matchReasons": [
      "업력 ${companyData.businessAge}년으로 3년 이상 자격요건 충족",
      "벤처기업 인증으로 우대 가점 예상",
      "R&D 투자비율 ${companyData.rdRatio}%로 기술개발사업 적합"
    ],
    "strengths": [
      "특허 ${companyData.patentCount}건 보유로 기술성 평가 유리",
      "청년고용 ${companyData.youthRatio}%로 고용창출 가점"
    ],
    "weaknesses": [
      "매출 규모가 작아 사업성 평가 주의 필요"
    ]
  }
]
\`\`\`

중요:
- 점수는 보수적으로 계산 (과대평가 금지)
- 실제 자격요건이 명시된 경우만 높은 점수
- JSON 형식 엄수
- 상위 50개만 반환
`;

    console.log('🔄 Gemini API 호출...');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 오류: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisText) {
      throw new Error('Gemini 응답이 비어있습니다.');
    }

    // JSON 추출
    let jsonText = analysisText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let matchedPrograms;
    try {
      matchedPrograms = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('JSON 파싱 실패:', jsonText.substring(0, 500));
      throw new Error('AI 응답을 파싱할 수 없습니다.');
    }

    // 원본 프로그램 정보와 병합
    const enrichedPrograms = matchedPrograms.map(match => {
      const original = programs.find(p => p.id === match.id);
      return {
        ...original,
        ...match
      };
    });

    // 점수순 정렬
    enrichedPrograms.sort((a, b) => b.matchScore - a.matchScore);

    console.log(`✅ 매칭 완료: ${enrichedPrograms.length}개 프로그램`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        matchedPrograms: enrichedPrograms
      })
    };

  } catch (error) {
    console.error('❌ 매칭 분석 오류:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        matchedPrograms: []
      })
    };
  }
};
