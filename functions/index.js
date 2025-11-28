/**
 * Firebase Functions for 기업 지원사업 AI 매칭
 * 기존 Netlify Functions를 Firebase 형식으로 변환
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

// 환경변수에서 API 키 가져오기
// firebase functions:config:set gemini.apikey="YOUR_KEY" bizinfo.apikey="YOUR_KEY"
const getGeminiApiKey = () => functions.config().gemini?.apikey || process.env.GEMINI_API_KEY;
const getBizinfoApiKey = () => functions.config().bizinfo?.apikey || process.env.BIZINFO_API_KEY;

// ============================================================
// 1. getBizInfoPrograms - 기업마당 API 연동
// ============================================================
exports.getBizInfoPrograms = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    try {
      const BIZINFO_API_KEY = getBizinfoApiKey();
      
      if (!BIZINFO_API_KEY) {
        throw new Error('BIZINFO_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      const {
        category = '',
        region = '',
        searchCnt = '500',
        pageUnit = '100',
        pageIndex = '1'
      } = data || {};

      console.log('📡 기업마당 API 호출 시작...');

      // 기업마당 API URL 구성
      let apiUrl = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}&dataType=json`;
      apiUrl += `&searchCnt=${searchCnt}`;
      
      if (category) {
        apiUrl += `&searchLclasId=${category}`;
      }
      if (region) {
        apiUrl += `&hashtags=${encodeURIComponent(region)}`;
      }
      apiUrl += `&pageUnit=${pageUnit}&pageIndex=${pageIndex}`;

      console.log('🔗 API URL:', apiUrl.replace(BIZINFO_API_KEY, '***'));

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`기업마당 API 오류: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      console.log('📥 응답 길이:', text.length);
      
      let apiData;
      try {
        apiData = JSON.parse(text);
      } catch (parseError) {
        console.error('JSON 파싱 실패, 응답 시작:', text.substring(0, 200));
        throw new Error('기업마당 API 응답이 JSON 형식이 아닙니다.');
      }

      // 응답 데이터 파싱
      let programs = [];

      if (apiData && apiData.jsonArray && apiData.jsonArray.item) {
        programs = Array.isArray(apiData.jsonArray.item) ? apiData.jsonArray.item : [apiData.jsonArray.item];
        console.log('📦 jsonArray.item 구조 확인');
      } else if (apiData && apiData.jsonArray && Array.isArray(apiData.jsonArray)) {
        programs = apiData.jsonArray;
        console.log('📦 jsonArray 배열 구조 확인');
      } else if (apiData && Array.isArray(apiData)) {
        programs = apiData;
        console.log('📦 배열 구조 확인');
      } else if (apiData && apiData.items) {
        programs = apiData.items;
        console.log('📦 items 구조 확인');
      } else {
        console.log('⚠️ 알 수 없는 응답 구조:', Object.keys(apiData || {}));
      }

      console.log(`✅ 기업마당 API 응답: ${programs.length}개 공고`);

      // 데이터 정규화
      const normalizedPrograms = programs.map((item, index) => ({
        id: item.pblancId || item.seq || `bizinfo-${index}`,
        name: item.pblancNm || item.title || '',
        organization: item.jrsdInsttNm || item.author || '',
        executor: item.excInsttNm || '',
        category: item.pldirSportRealmLclasCodeNm || item.lcategory || '',
        target: item.trgetNm || '',
        description: item.bsnsSumryCn || item.description || '',
        applicationMethod: item.reqstMthPapersCn || '',
        contact: item.refrncNm || '',
        applicationUrl: item.rceptEngnHmpgUrl || '',
        detailUrl: item.pblancUrl || item.link || '',
        applicationPeriod: item.reqstBeginEndDe || item.reqstDt || '',
        registeredDate: item.creatPnttm || item.pubDate || '',
        hashTags: item.hashTags || '',
        views: parseInt(item.inqireCo) || 0,
        attachmentUrl: item.flpthNm || '',
        attachmentName: item.fileNm || '',
        printFileUrl: item.printFlpthNm || '',
        printFileName: item.printFileNm || ''
      }));

      // 신청기간 파싱
      normalizedPrograms.forEach(program => {
        if (program.applicationPeriod) {
          const periods = program.applicationPeriod.split('~').map(s => s.trim());
          if (periods.length === 2) {
            program.applicationStart = periods[0];
            program.applicationEnd = periods[1];
            
            const today = new Date();
            const endDate = new Date(
              periods[1].substring(0, 4) + '-' + 
              periods[1].substring(4, 6) + '-' + 
              periods[1].substring(6, 8)
            );
            program.isOpen = endDate >= today;
          }
        }
      });

      // 통계 정보
      const stats = {
        total: normalizedPrograms.length,
        byCategory: {},
        openCount: normalizedPrograms.filter(p => p.isOpen).length
      };

      normalizedPrograms.forEach(p => {
        const cat = p.category || '기타';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      });

      console.log('📊 분야별 통계:', stats.byCategory);

      return {
        success: true,
        totalCount: normalizedPrograms.length,
        stats: stats,
        programs: normalizedPrograms,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ 기업마당 API 오류:', error);
      return {
        success: false,
        error: error.message,
        programs: [],
        timestamp: new Date().toISOString()
      };
    }
  });

// ============================================================
// 2. geminiSummary - Gemini AI 요약분석
// ============================================================
exports.geminiSummary = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    try {
      const GEMINI_API_KEY = getGeminiApiKey();
      
      if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
        return { success: false, error: 'API 키가 설정되지 않았습니다.' };
      }

      const { companyData, programs } = data || {};

      if (!companyData || !programs || programs.length === 0) {
        return { success: false, error: '기업 정보와 프로그램 목록이 필요합니다.' };
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

## 상위 추천 지원사업

${programs.map((p, i) => `
[${i + 1}번] ${p.name}
- 주관기관: ${p.organization || '미상'}
- 지원분야: ${p.category || '기타'}
- 지원대상: ${p.target || '미상'}
- 지원내용: ${p.description || '상세내용 확인 필요'}
- 신청기간: ${p.applicationPeriod || '상시'}
- 현재매칭점수: ${p.matchScore || 0}점
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
        return { success: false, error: `Gemini API 오류: ${response.status}` };
      }

      const apiData = await response.json();
      const aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // JSON 추출
      let jsonText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let summaryResults;
      try {
        summaryResults = JSON.parse(jsonText);
      } catch (e) {
        console.error('JSON 파싱 오류:', e);
        return { success: false, error: 'AI 응답 파싱 실패', rawText: aiText };
      }

      return { success: true, results: summaryResults };

    } catch (error) {
      console.error('서버 오류:', error);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 3. analyzeProgramPDF - PDF 상세 분석
// ============================================================
exports.analyzeProgramPDF = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    try {
      const { pdfUrl, companyData } = data || {};
      
      const GEMINI_API_KEY = getGeminiApiKey();
      
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
      
      return { success: true, analysis };
      
    } catch (error) {
      console.error('❌ PDF 분석 실패:', error.message);
      return { success: false, error: error.message };
    }
  });

// ============================================================
// 4. analyzeCompanyMatch - AI 기업 매칭 분석
// ============================================================
exports.analyzeCompanyMatch = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    try {
      const { companyData, programs } = data || {};
      const GEMINI_API_KEY = getGeminiApiKey();

      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      console.log(`🤖 AI 매칭 분석 시작: ${programs?.length || 0}개 프로그램`);

      const prompt = `
당신은 한국의 정부지원사업 전문 컨설턴트입니다.
다음 기업 정보를 분석하고, 제공된 지원사업 목록에서 가장 적합한 사업을 추천하세요.

# 기업 정보
\`\`\`json
{
  "기업명": "${companyData.companyName}",
  "업력": ${companyData.businessAge || 0}년,
  "직원수": ${companyData.employees || 0}명,
  "연매출": ${((companyData.revenue || 0) / 100000000).toFixed(0)}억원,
  "지역": "${companyData.region || ''}",
  "업종": "${companyData.industry || ''}",
  "기업유형": "${companyData.companyType || ''}",
  "인증": {
    "벤처기업": ${companyData.hasVenture || false},
    "이노비즈": ${companyData.hasInnobiz || false},
    "메인비즈": ${companyData.hasMainbiz || false}
  },
  "특허보유": ${companyData.patentCount || 0}건,
  "R&D투자비율": ${companyData.rdRatio || 0}%,
  "청년고용비율": ${companyData.youthRatio || 0}%,
  "수출기업": ${companyData.isExporting || false},
  "R&D부서": ${companyData.hasRnD || false}
}
\`\`\`

# 지원사업 목록 (${programs?.length || 0}개)
\`\`\`json
${JSON.stringify((programs || []).slice(0, 100).map(p => ({
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
      "업력 요건 충족",
      "벤처기업 인증으로 우대 가점 예상",
      "R&D 투자비율로 기술개발사업 적합"
    ],
    "strengths": [
      "특허 보유로 기술성 평가 유리",
      "청년고용으로 고용창출 가점"
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

      const apiData = await response.json();
      const analysisText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;

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
        const original = (programs || []).find(p => p.id === match.id);
        return {
          ...original,
          ...match
        };
      });

      // 점수순 정렬
      enrichedPrograms.sort((a, b) => b.matchScore - a.matchScore);

      console.log(`✅ 매칭 완료: ${enrichedPrograms.length}개 프로그램`);

      return {
        success: true,
        matchedPrograms: enrichedPrograms
      };

    } catch (error) {
      console.error('❌ 매칭 분석 오류:', error);
      return {
        success: false,
        error: error.message,
        matchedPrograms: []
      };
    }
  });
