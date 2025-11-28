/**
 * 기업마당 공고 PDF 상세 분석
 * Gemini 2.5 Flash로 PDF 전체 읽고 정확한 정보 추출
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { pdfUrl, companyData } = JSON.parse(event.body || '{}');
    
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    if (!pdfUrl) {
      throw new Error('PDF URL이 제공되지 않았습니다.');
    }
    
    console.log('📄 PDF 상세 분석 시작:', pdfUrl);
    
    // 1. PDF 다운로드
    console.log('🔽 PDF 다운로드...');
    const pdfResponse = await fetch(pdfUrl);
    
    if (!pdfResponse.ok) {
      throw new Error(`PDF 다운로드 실패: ${pdfResponse.status}`);
    }
    
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    
    console.log('📦 PDF 크기:', Math.round(pdfBuffer.byteLength / 1024), 'KB');
    
    // 2. Gemini API로 PDF 분석
    console.log('🤖 Gemini PDF 분석 시작...');
    
    const prompt = `
당신은 한국의 정부지원사업 전문 컨설턴트입니다.
첨부된 공고문 PDF를 분석하여 핵심 정보를 추출하세요.

# 분석할 기업 정보
${JSON.stringify(companyData, null, 2)}

# 추출해야 할 정보
1. 자격요건 (기업규모, 업력, 필수인증, 제외대상)
2. 평가기준 (평가항목과 배점)
3. 제출서류 (필수/선택)
4. 지원규모 (선정기업수, 지원금액)
5. 일정 (접수기간, 선정일)
6. 기업 매칭 분석 (자격충족여부, 강점, 약점, 선정확률)

# 출력 형식
반드시 JSON 형식으로만 응답하세요.

{
  "eligibility": {
    "companySize": "중소기업",
    "businessAge": "3년 이상",
    "certifications": ["벤처기업", "이노비즈"],
    "excluded": ["결격사유"]
  },
  "evaluation": {
    "criteria": [{"category": "기술성", "points": 40}],
    "totalPoints": 100
  },
  "documents": {
    "required": ["사업계획서", "재무제표"],
    "optional": ["특허증"]
  },
  "budget": {
    "selectedCompanies": 100,
    "maxPerCompany": "1억원",
    "totalBudget": "100억원"
  },
  "schedule": {
    "applicationPeriod": "2025.01.01 ~ 2025.01.31",
    "selectionDate": "2025.02.28"
  },
  "companyMatch": {
    "eligible": true,
    "strengths": ["강점1", "강점2"],
    "weaknesses": ["약점1"],
    "selectionProbability": 70,
    "recommendation": "추천 의견"
  }
}
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
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096
          }
        })
      }
    );
    
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API 오류: ${geminiResponse.status} - ${errorText}`);
    }
    
    const geminiData = await geminiResponse.json();
    
    // 응답 검증
    if (!geminiData.candidates || !geminiData.candidates[0] || !geminiData.candidates[0].content) {
      console.error('Gemini 응답:', JSON.stringify(geminiData));
      throw new Error('Gemini 응답이 비어있습니다.');
    }
    
    const analysisText = geminiData.candidates[0].content.parts[0].text;
    
    // JSON 추출 (마크다운 제거)
    let jsonText = analysisText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let analysis;
    try {
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('JSON 파싱 실패:', jsonText.substring(0, 500));
      throw new Error('AI 응답을 파싱할 수 없습니다.');
    }
    
    console.log('✅ PDF 분석 완료');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        analysis: analysis
      })
    };
    
  } catch (error) {
    console.error('❌ PDF 분석 실패:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
