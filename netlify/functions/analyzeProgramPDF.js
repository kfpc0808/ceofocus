/**
 * 기업마당 공고 PDF 상세 분석
 * Gemini 2.5 Flash로 PDF 읽고 핵심 정보만 빠르게 추출
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
    
    console.log('📄 PDF 분석 시작:', pdfUrl);
    
    // 1. PDF 다운로드 (타임아웃 5초)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    let pdfResponse;
    try {
      pdfResponse = await fetch(pdfUrl, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (e) {
      clearTimeout(timeout);
      throw new Error('PDF 다운로드 시간 초과');
    }
    
    if (!pdfResponse.ok) {
      throw new Error(`PDF 다운로드 실패: ${pdfResponse.status}`);
    }
    
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfSizeKB = Math.round(pdfBuffer.byteLength / 1024);
    console.log('📦 PDF 크기:', pdfSizeKB, 'KB');
    
    // PDF가 너무 크면 스킵 (5MB 이상)
    if (pdfBuffer.byteLength > 5 * 1024 * 1024) {
      throw new Error('PDF 파일이 너무 큽니다 (5MB 초과)');
    }
    
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    
    // 2. Gemini API - 간단한 프롬프트로 빠르게 분석
    const prompt = `이 공고문 PDF를 분석하여 JSON으로 응답하세요.

기업정보: ${companyData?.companyName || '미입력'}, 업력 ${companyData?.businessAge || 0}년, 매출 ${companyData?.revenue || 0}원

다음 형식으로만 응답:
{"eligibility":{"companySize":"중소기업","businessAge":"3년이상","certifications":["벤처"]},"budget":{"maxPerCompany":"1억","totalBudget":"100억"},"schedule":{"period":"2025.01~02","deadline":"2025.01.31"},"companyMatch":{"eligible":true,"strengths":["강점1"],"weaknesses":["약점1"],"selectionProbability":70,"recommendation":"추천의견"}}`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024
          }
        })
      }
    );
    
    if (!geminiResponse.ok) {
      throw new Error(`Gemini API 오류: ${geminiResponse.status}`);
    }
    
    const geminiData = await geminiResponse.json();
    
    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Gemini 응답 없음');
    }
    
    const analysisText = geminiData.candidates[0].content.parts[0].text;
    
    // JSON 추출
    let jsonText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let analysis;
    try {
      analysis = JSON.parse(jsonText);
    } catch (e) {
      // JSON 파싱 실패 시 기본 구조 반환
      analysis = {
        eligibility: { companySize: "확인필요", businessAge: "확인필요" },
        companyMatch: { eligible: null, recommendation: analysisText.substring(0, 200) }
      };
    }
    
    console.log('✅ PDF 분석 완료');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, analysis })
    };
    
  } catch (error) {
    console.error('❌ PDF 분석 실패:', error.message);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
