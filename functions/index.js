/**
 * Firebase Functions for 기업 지원사업 AI 매칭
 * Netlify Functions → Firebase Functions 마이그레이션
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

// ⚠️ Gemini API 키 설정 (Firebase Console에서 환경변수로 설정)
// firebase functions:config:set gemini.apikey="YOUR_API_KEY"
const GEMINI_API_KEY = functions.config().gemini?.apikey || process.env.GEMINI_API_KEY;

// Gemini API 엔드포인트
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// 기업마당 API 설정
const BIZINFO_API_URL = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const BIZINFO_API_KEY = 'YOUR_BIZINFO_API_KEY'; // 기업마당 API 키

/**
 * 1. 기업마당 지원사업 목록 가져오기
 */
exports.getBizInfoPrograms = functions
  .region('asia-northeast3') // 서울 리전
  .https.onCall(async (data, context) => {
    try {
      // 기업마당 API 호출
      const response = await fetch(`${BIZINFO_API_URL}?crtfcKey=${BIZINFO_API_KEY}&dataType=json&pageSize=100`);
      
      if (!response.ok) {
        throw new Error(`기업마당 API 오류: ${response.status}`);
      }
      
      const result = await response.json();
      const programs = result.jsonArray || [];
      
      // 데이터 가공
      const processedPrograms = programs.map((item, index) => ({
        id: item.pblancId || `prog_${index}`,
        name: item.pblancNm || '제목 없음',
        organization: item.jrsdInsttNm || '미상',
        category: item.bsnsSumryCn || '기타',
        region: item.areaNm || '전국',
        targetCompany: item.trgetNm || '',
        supportType: item.pldirSportCn || '',
        applicationPeriod: item.reqstPeriod || '상시',
        description: item.bsnsSumryCn || '',
        detailUrl: item.detailUrl || '',
        printFileUrl: item.printFileUrl || '',
        attachmentUrl: item.attachmentUrl || ''
      }));
      
      return {
        success: true,
        programs: processedPrograms,
        stats: {
          total: processedPrograms.length
        }
      };
      
    } catch (error) {
      console.error('getBizInfoPrograms 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

/**
 * 2. Gemini AI 요약분석
 */
exports.geminiSummary = functions
  .region('asia-northeast3')
  .runWith({
    timeoutSeconds: 300, // 5분 타임아웃
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    // 로그인 확인 (선택사항)
    // if (!context.auth) {
    //   throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
    // }
    
    const { companyData, programs } = data;
    
    if (!companyData || !programs || programs.length === 0) {
      return {
        success: false,
        error: '분석할 데이터가 없습니다.'
      };
    }
    
    try {
      const results = [];
      
      // 각 프로그램에 대해 AI 요약 생성
      for (const program of programs) {
        const prompt = `
당신은 한국 기업 지원사업 전문 컨설턴트입니다.

[기업 정보]
- 기업명: ${companyData.companyName || '미입력'}
- 업종(KSIC): ${companyData.ksicCode || '미입력'}
- 기업규모: ${companyData.companySize || '미입력'}
- 소재지: ${companyData.locationSido || '미입력'}
- 매출액: ${companyData.revenueRecent || '미입력'}원
- 상시근로자: ${companyData.employeesTotal || '미입력'}명

[지원사업 정보]
- 사업명: ${program.name || '미입력'}
- 지원기관: ${program.organization || '미입력'}
- 지원분야: ${program.category || '미입력'}
- 지원대상: ${program.targetCompany || '미입력'}
- 지원내용: ${program.supportType || program.description || '미입력'}
- 신청기간: ${program.applicationPeriod || '미입력'}

위 기업이 이 지원사업에 적합한지 2-3문장으로 간단히 요약하고,
💡로 시작하는 추천 이유나 주의사항을 1문장으로 작성해주세요.

형식:
요약: (2-3문장)
추천: 💡 (1문장)
`;

        try {
          const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500
              }
            })
          });
          
          if (!response.ok) {
            console.error(`Gemini API 오류: ${response.status}`);
            continue;
          }
          
          const aiResult = await response.json();
          const aiText = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
          
          // 응답 파싱
          const summaryMatch = aiText.match(/요약[:\s]*([\s\S]*?)(?=추천|💡|$)/i);
          const recommendMatch = aiText.match(/(?:추천[:\s]*)?💡\s*([\s\S]*?)$/i);
          
          results.push({
            programId: program.id,
            programName: program.name,
            summary: summaryMatch ? summaryMatch[1].trim() : aiText.substring(0, 200),
            recommendation: recommendMatch ? recommendMatch[1].trim() : ''
          });
          
          // API 호출 간격 (분당 15회 제한 대응)
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (aiError) {
          console.error(`AI 분석 오류 (${program.name}):`, aiError);
        }
      }
      
      return {
        success: true,
        results: results
      };
      
    } catch (error) {
      console.error('geminiSummary 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

/**
 * 3. PDF 상세분석
 */
exports.analyzeProgramPDF = functions
  .region('asia-northeast3')
  .runWith({
    timeoutSeconds: 120,
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    const { pdfUrl, companyData } = data;
    
    if (!pdfUrl) {
      return {
        success: false,
        error: 'PDF URL이 없습니다.'
      };
    }
    
    try {
      // Gemini의 PDF 분석 기능 사용 (URL 직접 전달)
      const prompt = `
이 PDF 공고문을 분석하여 다음 정보를 추출해주세요:

[기업 정보]
- 기업명: ${companyData?.companyName || '미입력'}
- 업종: ${companyData?.ksicCode || '미입력'}
- 기업규모: ${companyData?.companySize || '미입력'}

[추출 항목]
1. 지원자격 요건 (필수/우대)
2. 지원내용 및 규모
3. 평가기준
4. 제출서류
5. 이 기업의 선정 가능성 (상/중/하)
6. 신청 전략 제안

간결하게 핵심만 정리해주세요.
`;

      const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                fileData: {
                  mimeType: 'application/pdf',
                  fileUri: pdfUrl
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000
          }
        })
      });
      
      if (!response.ok) {
        // PDF 직접 분석 실패 시 URL만 참조하여 분석
        const fallbackResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `${prompt}\n\nPDF URL: ${pdfUrl}\n\n위 URL의 공고문을 기반으로 일반적인 지원사업 분석을 제공해주세요.`
              }]
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1500
            }
          })
        });
        
        const fallbackResult = await fallbackResponse.json();
        const analysisText = fallbackResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        return {
          success: true,
          analysis: {
            detailedAnalysis: analysisText,
            applicationStrategy: '',
            expectedBenefit: '',
            priority: '중'
          }
        };
      }
      
      const result = await response.json();
      const analysisText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // 선정 가능성 추출
      let priority = '중';
      if (analysisText.includes('선정 가능성: 상') || analysisText.includes('높음')) {
        priority = '상';
      } else if (analysisText.includes('선정 가능성: 하') || analysisText.includes('낮음')) {
        priority = '하';
      }
      
      return {
        success: true,
        analysis: {
          detailedAnalysis: analysisText,
          applicationStrategy: '',
          expectedBenefit: '',
          priority: priority
        }
      };
      
    } catch (error) {
      console.error('analyzeProgramPDF 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

/**
 * 4. AI 기업 매칭 분석
 */
exports.analyzeCompanyMatch = functions
  .region('asia-northeast3')
  .runWith({
    timeoutSeconds: 300,
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    const { companyData, programs } = data;
    
    if (!companyData || !programs) {
      return {
        success: false,
        error: '분석 데이터가 없습니다.'
      };
    }
    
    try {
      // 간단한 매칭 로직 (실제로는 더 복잡한 로직 적용 가능)
      const matchedPrograms = programs
        .map(program => {
          let score = 50; // 기본 점수
          
          // 지역 매칭
          if (program.region === '전국' || program.region?.includes(companyData.locationSido)) {
            score += 20;
          }
          
          // 기업규모 매칭
          if (program.targetCompany?.includes(companyData.companySize)) {
            score += 15;
          }
          
          // 업종 매칭
          if (program.category?.includes(companyData.ksicCode?.substring(0, 2))) {
            score += 15;
          }
          
          return {
            ...program,
            matchScore: Math.min(score, 100)
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 20);
      
      return {
        success: true,
        matchedPrograms: matchedPrograms
      };
      
    } catch (error) {
      console.error('analyzeCompanyMatch 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
