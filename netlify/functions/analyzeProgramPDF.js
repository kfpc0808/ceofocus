/**
 * 기업마당 공고 PDF 상세 분석
 * Gemini 2.5 Flash로 PDF 전체 읽고 정확한 정보 추출
 */

const fetch = require('node-fetch');

exports.handler = async (event) => {
  try {
    const { pdfUrl, companyData } = JSON.parse(event.body || '{}');
    
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    console.log('📄 PDF 상세 분석 시작:', pdfUrl);
    
    // 1. PDF 다운로드
    console.log('🔽 PDF 다운로드...');
    const pdfResponse = await fetch(pdfUrl);
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    
    // 2. Gemini API로 PDF 분석
    console.log('🤖 Gemini PDF 분석 시작...');
    
    const prompt = `
당신은 한국의 정부지원사업 전문 컨설턴트입니다.
첨부된 공고문 PDF를 **매우 상세하게** 분석하여 다음 정보를 정확히 추출하세요.

# 분석할 기업 정보
\`\`\`json
${JSON.stringify(companyData, null, 2)}
\`\`\`

# 추출해야 할 정보

## 1. 자격요건 (매우 정확하게!)
- 기업 규모: 매출액 범위 (숫자로)
- 업력: 최소/최대 년수
- 필수 인증: 벤처/이노비즈/메인비즈 등
- 필수 조건: R&D 비율, 특허, 고용인원 등
- 우대 조건: 가점 요소와 배점
- 제외 대상: 결격사유

## 2. 평가기준 (점수 배분)
- 각 평가항목과 배점
- 가점 요소와 배점
- 합계 점수

## 3. 제출서류
- 필수 서류 목록
- 선택 서류 목록
- 서류 양식 번호

## 4. 선정 규모
- 선정 기업 수
- 총 예산
- 기업당 지원 금액 (평균/최대)
- 예상 경쟁률

## 5. 일정
- 접수 기간
- 심사 일정
- 최종 선정일
- 사업 수행 기간

## 6. 기업 매칭 분석
위 기업이 이 사업에 신청할 경우:
- 자격요건 충족 여부 (각 항목별)
- 예상 평가 점수 (근거와 함께)
- 강점 (점수가 높을 항목)
- 약점 (점수가 낮을 항목)
- 개선 방안
- 최종 선정 확률 (%)

# 출력 형식
반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 다른 텍스트는 포함하지 마세요.

\`\`\`json
{
  "eligibility": {
    "required": {
      "companySize": { "type": "중소기업", "maxRevenue": 숫자 },
      "businessAge": { "min": 숫자, "max": 숫자 },
      "certifications": ["벤처기업", "이노비즈"],
      "rdRatio": 숫자,
      "patentCount": 숫자,
      "employeeCount": 숫자,
      "other": ["기타 조건"]
    },
    "preferred": [
      { "condition": "조건명", "points": 숫자 }
    ],
    "excluded": ["결격사유1", "결격사유2"]
  },
  "evaluation": {
    "criteria": [
      {
        "category": "기술성",
        "points": 40,
        "items": [
          { "name": "기술차별성", "points": 15 }
        ]
      }
    ],
    "bonusPoints": [
      { "condition": "조건", "points": 숫자 }
    ],
    "totalPoints": 100
  },
  "documents": {
    "required": ["서류1", "서류2"],
    "optional": ["서류3"],
    "notes": "특이사항"
  },
  "budget": {
    "selectedCompanies": 숫자,
    "totalBudget": 숫자,
    "avgPerCompany": 숫자,
    "maxPerCompany": 숫자,
    "estimatedCompetition": "1:X"
  },
  "schedule": {
    "application": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "review": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "selection": "YYYY-MM-DD",
    "execution": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "months": 숫자 }
  },
  "companyMatch": {
    "eligible": true/false,
    "eligibilityDetails": [
      { "requirement": "조건", "status": "충족/미충족", "value": "기업값" }
    ],
    "estimatedScore": {
      "technology": 숫자,
      "business": 숫자,
      "capability": 숫자,
      "bonus": 숫자,
      "total": 숫자
    },
    "strengths": ["강점1", "강점2"],
    "weaknesses": ["약점1", "약점2"],
    "improvements": ["개선방안1", "개선방안2"],
    "selectionProbability": 숫자,
    "recommendation": "최종 추천 의견"
  }
}
\`\`\`

중요: 
1. 모든 숫자는 정확히 추출하세요 (예: "100억원" → 10000000000)
2. 추정이 필요한 경우 근거를 명시하세요
3. 애매한 경우 보수적으로 판단하세요
4. JSON 형식을 정확히 지키세요
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: pdfBase64
                }
              }
            ]
          }]
        })
      }
    );
    
    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates[0].content.parts[0].text;
    
    // JSON 추출 (마크다운 제거)
    let jsonText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(jsonText);
    
    console.log('✅ PDF 분석 완료');
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        success: true,
        analysis: analysis
      })
    };
    
  } catch (error) {
    console.error('❌ PDF 분석 실패:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
