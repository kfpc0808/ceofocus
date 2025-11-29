/**
 * Firebase Functions for 기업 지원사업 AI 매칭
 * 기존 Netlify Functions를 Firebase 형식으로 변환
 * v2.1 - 15개 전체 분석 강제, 프롬프트 강화 (2024-11-30)
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
// 2. geminiSummary - Gemini AI 적합성 판단 + 요약분석 (통합)
// ============================================================
exports.geminiSummary = functions
  .region('asia-northeast3')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    try {
      const GEMINI_API_KEY = getGeminiApiKey();
      
      if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
        return { success: false, error: 'API 키가 설정되지 않았습니다.' };
      }

      const { companyData, programs: rawPrograms } = data || {};

      if (!companyData || !rawPrograms || rawPrograms.length === 0) {
        return { success: false, error: '기업 정보와 프로그램 목록이 필요합니다.' };
      }

      // 공고 수 15개로 제한 (응답 품질 및 속도 개선)
      const programs = rawPrograms.slice(0, 15);

      console.log(`🤖 AI 분석 시작: ${programs.length}개 공고 (전체 ${rawPrograms.length}개 중)`);

      // 업종 대분류 추출 (KSIC 앞 2자리)
      const ksicPrefix = (companyData.ksicCode || '').substring(0, 2);
      const ksicCategoryMap = {
        '01': '농업', '02': '임업', '03': '어업',
        '10': '식품제조', '11': '음료제조', '13': '섬유', '14': '의류',
        '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
        '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
        '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
        '41': '건설', '42': '토목',
        '45': '자동차판매', '46': '도매', '47': '소매',
        '49': '육상운송', '52': '물류창고',
        '55': '숙박', '56': '음식점',
        '58': '출판', '59': '영상제작', '60': '방송', '61': '통신', '62': '소프트웨어', '63': '정보서비스',
        '64': '금융', '70': '본사', '71': '연구개발', '72': '과학기술서비스', '73': '전문서비스',
        '74': '디자인', '75': '수의업', '79': '여행', '80': '경비', '81': '시설관리',
        '85': '교육', '86': '보건', '87': '사회복지', '90': '문화예술', '91': '스포츠'
      };
      const ksicCategory = ksicCategoryMap[ksicPrefix] || '기타';

      // 업력 계산
      const businessAge = companyData.businessAge || 0;
      
      // 대표자 나이 계산
      let ceoAge = 0;
      if (companyData.ceoBirth) {
        const birthYear = parseInt(companyData.ceoBirth.substring(0, 4));
        ceoAge = new Date().getFullYear() - birthYear;
      }

      // ========================================
      // 상세 프롬프트 생성
      // ========================================
      const prompt = `당신은 대한민국 정부 지원사업 자격요건 심사 전문가입니다.
아래 기업 정보를 바탕으로, 각 공고가 이 기업에 "적합"한지 엄격하게 판단하세요.
부적합한 공고는 반드시 제외하고, 적합한 공고만 요약 분석을 제공하세요.

═══════════════════════════════════════════════════════════════
📌 분석 대상 기업 정보
═══════════════════════════════════════════════════════════════
• 기업명: ${companyData.companyName || '미입력'}
• 소재지: ${companyData.locationSido || '미입력'} ${companyData.locationSigungu || ''}
• 수도권 여부: ${companyData.capitalArea === 'Y' ? '수도권 (서울/경기/인천)' : '비수도권'}
• 기업규모: ${companyData.companySize || '미입력'}
• 업종코드(KSIC): ${companyData.ksicCode || '미입력'} (${ksicCategory})
• 업력: ${businessAge}년 (설립일: ${companyData.establishDate || '미입력'})
• 상시근로자 수: ${companyData.employeesTotal || 0}명
• 최근 매출액: ${companyData.revenueRecent ? Math.round(companyData.revenueRecent / 100000000) + '억원' : '미입력'}
• 대표자 성별: ${companyData.ceoGender === 'M' ? '남성' : companyData.ceoGender === 'F' ? '여성' : '미입력'}
• 대표자 나이: ${ceoAge > 0 ? ceoAge + '세' : '미입력'}
• 벤처기업 인증: ${companyData.certVenture === 'Y' ? '있음' : '없음'}
• 이노비즈 인증: ${companyData.certInnobiz === 'Y' ? '있음' : '없음'}
• 메인비즈 인증: ${companyData.certMainbiz === 'Y' ? '있음' : '없음'}
• 여성기업 인증: ${companyData.certWoman === 'Y' ? '있음' : '없음'}
• 사회적기업 여부: ${companyData.certSocial === 'Y' ? '사회적기업' : '일반기업'}
• 수출기업 여부: ${(companyData.exportRecent && companyData.exportRecent > 0) ? '수출기업 (수출액: ' + companyData.exportRecent + '$)' : '내수기업'}
• 연구조직 보유: ${companyData.researchOrg === 'Y' || companyData.researchOrg === '기업부설연구소' || companyData.researchOrg === '연구개발전담부서' ? '있음' : '없음'}
• 희망 지원분야: ${companyData.supportNeeds?.join(', ') || '전체'}

═══════════════════════════════════════════════════════════════
📌 적합성 판단 기준 (매우 엄격하게 적용)
═══════════════════════════════════════════════════════════════

【1. 지역 조건】 ❗ 가장 중요
다음 패턴이 보이면 해당 지역 기업만 가능:
- "○○지역 소재", "○○ 소재 기업", "○○지역 내"
- "○○도내", "○○시내", "○○권역"
- "[서울·경기·인천]", "[전남]", "[경북]" 등 대괄호 표기
- 사업수행기관에 지역명 포함 (예: "전남정보문화산업진흥원" → 전남 한정)
- "수도권", "비수도권", "지방" 표현

예외: "전국", "전 지역", 중앙부처 직접 운영 (전국 대상)

→ 기업 소재지(${companyData.locationSido})와 불일치하면 "부적합"

【2. 기업 규모 조건】
- "중기업", "중기업 대상" → 소기업 부적합
- "소기업 전용", "소기업만" → 중기업/중견기업 부적합
- "중견기업", "중견기업 전용" → 소기업/중기업 부적합
- "대기업" → 중소기업 부적합
- "중소기업" → 중견기업/대기업 부적합

→ 기업 규모(${companyData.companySize})와 불일치하면 "부적합"

【3. 업종 조건】
- "제조업", "제조기업", "제조업체" → 비제조업 부적합
- "농업", "농기계", "농어업" → 농업 외 부적합
- "수산업", "어업", "수산물" → 어업 외 부적합
- "IT기업", "SW기업", "ICT기업" → IT 외 부적합
- "관광업", "여행사", "숙박업" → 관광업 외 부적합
- "바이오", "제약", "의료기기" → 바이오/의료 외 부적합
- "뿌리산업" (주조, 금형, 용접, 표면처리, 열처리, 소성가공) → 해당 업종 외 부적합
- "콘텐츠", "게임", "영상" → 콘텐츠 외 부적합

→ 기업 업종(${ksicCategory}, KSIC: ${companyData.ksicCode})과 불일치하면 "부적합"

【4. 업력 조건】
- "창업 3년 이내", "3년 미만" → 업력 ${businessAge}년이 3년 초과면 부적합
- "창업 7년 이내", "7년 미만" → 업력 ${businessAge}년이 7년 초과면 부적합
- "업력 3년 이상", "설립 3년 이상" → 업력 ${businessAge}년이 3년 미만이면 부적합
- "예비창업자", "창업예정자" → 이미 설립된 기업은 부적합

【5. 기업 형태/인증 조건】
- "협동조합", "협동조합만" → 일반기업 부적합
- "사회적기업", "사회적경제기업" → 일반기업 부적합 (현재: ${companyData.certSocial === 'Y' ? '사회적기업' : '일반기업'})
- "벤처기업 필수", "벤처기업만" → 벤처인증 없으면 부적합 (현재: ${companyData.certVenture === 'Y' ? '있음' : '없음'})
- "여성기업", "여성CEO" → 여성기업 아니면 부적합 (현재: ${companyData.certWoman === 'Y' ? '있음' : '없음'})
- "장애인기업" → 장애인기업 아니면 부적합

【6. 특수 조건】
- "○○ 선정기업", "기존 참여기업" → 기존 선정 필요, 신규기업 부적합
- "수출기업", "수출실적 보유" → 내수기업 부적합 (현재: ${(companyData.exportRecent && companyData.exportRecent > 0) ? '수출기업' : '내수기업'})
- "청년창업", "청년CEO", "만 39세 이하" → 대표자 ${ceoAge}세가 40세 이상이면 부적합
- "시니어", "중장년", "만 50세 이상" → 대표자 ${ceoAge}세가 50세 미만이면 부적합
- "1인 기업", "1인 창조기업" → 직원 ${companyData.employeesTotal}명이 2명 이상이면 부적합
- "비영리", "비영리법인" → 영리기업 부적합
- "개인 소비자 대상", "B2C" → 기업 대상 사업이 아님, 부적합

【7. 분야 매칭】 (희망 분야: ${companyData.supportNeeds?.join(', ') || '전체'})
- 기업이 "전체"를 선택했으면 분야 무관
- 특정 분야 선택 시, 공고 분야와 최소한의 관련성 필요

═══════════════════════════════════════════════════════════════
📌 분석 대상 공고 목록 (${programs.length}개)
═══════════════════════════════════════════════════════════════
${programs.map((p, i) => `
【공고 ${i + 1}】 ID: ${p.id}
• 공고명: ${p.name || ''}
• 주관기관: ${p.organization || ''}
• 수행기관: ${p.executor || ''}
• 지원분야: ${p.category || ''}
• 지원대상: ${p.target || ''}
• 사업개요: ${p.description || ''}
• 해시태그: ${p.hashTags || ''}
• 신청기간: ${p.applicationPeriod || ''}
`).join('\n')}

═══════════════════════════════════════════════════════════════
📌 출력 형식 (반드시 준수)
═══════════════════════════════════════════════════════════════

**모든 ${programs.length}개 공고에 대해** 아래 JSON 배열로 출력하세요.
적합/부적합 여부와 관계없이 모든 공고를 분석 결과에 포함하세요.

[
  {
    "id": "공고 ID (위에 표시된 ID 그대로)",
    "programId": "공고 ID (id와 동일하게)",
    "index": 0,
    "eligible": true 또는 false,
    "fitScore": 50~100 (적합도 점수. 적합:70-100, 부적합:50-69),
    "eligibleReason": "적합인 경우, 왜 이 기업에 적합한지 핵심 이유 1-2문장",
    "ineligibleReason": "부적합인 경우, 왜 부적합한지 핵심 이유 1-2문장",
    "summary": "이 지원사업의 핵심 내용, 지원금액, 지원범위, 혜택 등을 300자 내외로 상세하게 설명. 기업이 이 사업을 통해 무엇을 받을 수 있는지 구체적으로 작성.",
    "recommendation": "이 기업이 신청해야 하는 이유, 자격요건 충족 여부, 선정 가능성, 기대효과 등을 200자 내외로 구체적으로 설명. 부적합인 경우 유사 기업이나 협력사 추천."
  }
]

⚠️ 중요 지시사항 (절대 위반 금지):
1. **반드시 모든 ${programs.length}개 공고에 대해 결과를 출력하세요.** 
   - 정확히 ${programs.length}개의 JSON 객체가 배열에 있어야 합니다.
   - 생략하면 시스템 오류가 발생합니다!
2. 적합(eligible: true) 공고는 fitScore 70-100, 부적합(eligible: false)은 fitScore 50-69로 설정
3. 적합한 공고는 eligibleReason을 작성, 부적합한 공고는 ineligibleReason을 작성
4. 지역 조건은 특히 엄격하게 적용하세요.
5. 반드시 유효한 JSON 배열만 출력하세요. 설명이나 마크다운 없이 순수 JSON만 응답하세요.
6. summary는 300자 내외로 충분히 상세하게 작성하세요.
7. recommendation은 200자 내외로 구체적인 이유와 기대효과를 작성하세요.

🚨 최종 확인: 출력하는 JSON 배열에 정확히 ${programs.length}개의 객체가 있는지 확인하세요!
`;

      // Gemini API 호출
      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API 오류:', response.status, errorText);
        return { success: false, error: `Gemini API 오류: ${response.status}` };
      }

      const apiData = await response.json();
      const aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      console.log('📝 AI 응답 길이:', aiText.length);

      // JSON 추출
      let jsonText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let summaryResults;
      try {
        summaryResults = JSON.parse(jsonText);
      } catch (e) {
        console.error('JSON 파싱 오류:', e);
        console.error('원본 텍스트:', jsonText.substring(0, 500));
        return { success: false, error: 'AI 응답 파싱 실패', rawText: aiText };
      }

      // 적합한 공고만 필터링
      const eligibleResults = Array.isArray(summaryResults) 
        ? summaryResults.filter(r => r.eligible === true)
        : [];

      console.log(`✅ AI 분석 완료: ${programs.length}개 중 ${eligibleResults.length}개 적합`);

      return { 
        success: true, 
        results: eligibleResults,
        totalAnalyzed: programs.length,
        eligibleCount: eligibleResults.length
      };

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
  .runWith({ timeoutSeconds: 180, memory: '1GB' })
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
      
      // 1. PDF 다운로드 (타임아웃 15초로 증가)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      let pdfResponse;
      try {
        pdfResponse = await fetch(pdfUrl, { signal: controller.signal });
        clearTimeout(timeout);
      } catch (e) {
        clearTimeout(timeout);
        throw new Error('PDF 다운로드 시간 초과 (15초)');
      }
      
      if (!pdfResponse.ok) {
        throw new Error(`PDF 다운로드 실패: ${pdfResponse.status}`);
      }
      
      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfSizeKB = Math.round(pdfBuffer.byteLength / 1024);
      console.log('📦 PDF 크기:', pdfSizeKB, 'KB');
      
      // PDF가 너무 크면 스킵 (10MB로 증가)
      if (pdfBuffer.byteLength > 10 * 1024 * 1024) {
        throw new Error('PDF 파일이 너무 큽니다 (10MB 초과)');
      }
      
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
      
      // PDF에서 텍스트 추출 (pdf-parse 사용)
      let pdfText = '';
      try {
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(Buffer.from(pdfBuffer));
        pdfText = pdfData.text;
        console.log('📄 PDF 텍스트 추출 완료:', pdfText.length, '자');
      } catch (pdfError) {
        console.error('PDF 텍스트 추출 실패:', pdfError.message);
        // 텍스트 추출 실패 시 기본 메시지
        pdfText = 'PDF 텍스트 추출에 실패했습니다. 공고 정보를 직접 확인해주세요.';
      }
      
      // 텍스트가 너무 길면 앞부분만 사용 (약 50,000자 = 약 25,000 토큰)
      if (pdfText.length > 50000) {
        pdfText = pdfText.substring(0, 50000) + '\n\n... (이하 생략)';
      }
      
      // 업종 대분류 추출
      const ksicPrefix = (companyData?.ksicCode || '').substring(0, 2);
      const ksicCategoryMap = {
        '01': '농업', '02': '임업', '03': '어업',
        '10': '식품제조', '11': '음료제조', '13': '섬유', '14': '의류',
        '20': '화학', '21': '의약품', '22': '고무플라스틱', '23': '비금속광물',
        '24': '금속', '25': '금속가공', '26': '전자부품', '27': '의료기기',
        '28': '전기장비', '29': '기계장비', '30': '자동차', '31': '운송장비',
        '41': '건설', '42': '토목', '45': '자동차판매', '46': '도매', '47': '소매',
        '49': '육상운송', '52': '물류창고', '55': '숙박', '56': '음식점',
        '58': '출판', '59': '영상제작', '60': '방송', '61': '통신', 
        '62': '소프트웨어', '63': '정보서비스', '64': '금융',
        '70': '본사', '71': '연구개발', '72': '과학기술서비스', '73': '전문서비스',
        '74': '디자인', '79': '여행', '85': '교육', '86': '보건'
      };
      const ksicCategory = ksicCategoryMap[ksicPrefix] || '기타';
      
      // 대표자 나이 계산
      let ceoAge = 0;
      if (companyData?.ceoBirth) {
        const birthYear = parseInt(companyData.ceoBirth.substring(0, 4));
        ceoAge = new Date().getFullYear() - birthYear;
      }
      
      // 2. Gemini API - 프리미엄 상세분석 프롬프트 (Pro 모델용)
      const prompt = `당신은 20년 경력의 대한민국 정부지원사업 컨설팅 전문가입니다.
수천 건의 지원사업 신청을 도와왔고, 평가위원 경험도 있습니다.
이 PDF 공고문을 분석하여 아래 기업의 CEO에게 브리핑할 "프리미엄 분석 보고서"를 작성해주세요.

이 분석은 유료 서비스(건당 2,000원)로 제공되므로, 
무료 요약분석과는 차원이 다른 깊이 있고 실용적인 인사이트를 제공해야 합니다.

═══════════════════════════════════════════════════════════════
분석 대상 기업 프로필 (모든 항목을 공고 자격요건과 1:1 대조 필수)
═══════════════════════════════════════════════════════════════

【기업 기본정보】
• 기업명: ${companyData?.companyName || '미입력'}
• 법인형태: ${companyData?.companyType || '미입력'}
• 소재지: ${companyData?.locationSido || '미입력'} ${companyData?.locationSigungu || ''}
• 수도권 여부: ${companyData?.capitalArea === 'Y' ? '수도권 (서울/경기/인천)' : '비수도권'}
• 기업규모: ${companyData?.companySize || '미입력'}

【업종 및 사업분야】
• 업종코드(KSIC): ${companyData?.ksicCode || '미입력'}
• 업종 대분류: ${ksicCategory}
• 세부업종: ${companyData?.ksicName || '미입력'}
• 주력 제품/서비스: ${companyData?.productKeywords || '미입력'}

【업력 및 성장단계】
• 설립일: ${companyData?.establishDate || '미입력'}
• 업력: ${companyData?.businessAge || 0}년
• 성장단계: ${companyData?.businessAge <= 3 ? '초기창업기' : companyData?.businessAge <= 7 ? '성장기' : '성숙기'}

【재무현황】
• 최근 매출액: ${companyData?.revenueRecent ? Math.round(companyData.revenueRecent / 100000000) + '억원' : '미입력'}
• 전년 매출액: ${companyData?.revenuePrevious ? Math.round(companyData.revenuePrevious / 100000000) + '억원' : '미입력'}
• 영업이익: ${companyData?.profitRecent ? Math.round(companyData.profitRecent / 100000000) + '억원' : '미입력'}
• 부채비율: ${companyData?.debtRatio || '미입력'}%

【고용현황】
• 상시근로자: ${companyData?.employeesTotal || 0}명
• 청년근로자(만 15~34세): ${companyData?.employeesYouth || 0}명
• 여성근로자: ${companyData?.employeesFemale || 0}명
• 장애인근로자: ${companyData?.employeesDisabled || 0}명

【대표자 정보】
• 성별: ${companyData?.ceoGender === 'M' ? '남성' : companyData?.ceoGender === 'F' ? '여성' : '미입력'}
• 연령: ${ceoAge > 0 ? ceoAge + '세' : '미입력'} ${ceoAge > 0 && ceoAge <= 39 ? '(청년CEO)' : ceoAge >= 60 ? '(시니어CEO)' : ''}

【보유 인증현황】
• 벤처기업: ${companyData?.certVenture === 'Y' ? '✅ 보유' : '❌ 미보유'}
• 이노비즈: ${companyData?.certInnobiz === 'Y' ? '✅ 보유' : '❌ 미보유'}
• 메인비즈: ${companyData?.certMainbiz === 'Y' ? '✅ 보유' : '❌ 미보유'}
• 여성기업: ${companyData?.certWoman === 'Y' ? '✅ 보유' : '❌ 미보유'}
• 장애인기업: ${companyData?.certDisabled === 'Y' ? '✅ 보유' : '❌ 미보유'}
• 사회적기업: ${companyData?.certSocial === 'Y' ? '✅ 인증' : '❌ 비해당'}

【기술/연구역량】
• 연구조직: ${companyData?.researchOrg || '없음'}
• 등록특허: ${companyData?.patentsRegistered || 0}건
• 출원특허: ${companyData?.patentsPending || 0}건

【수출현황】
• 수출실적: ${(companyData?.exportRecent && companyData.exportRecent > 0) ? '있음 ($' + companyData.exportRecent.toLocaleString() + ')' : '없음 (내수기업)'}

【결격사유 체크】
• 국세체납: ${companyData?.taxArrears === 'N' ? '✅ 없음' : '⚠️ 있음'}
• 지방세체납: ${companyData?.localTaxArrears === 'N' ? '✅ 없음' : '⚠️ 있음'}

═══════════════════════════════════════════════════════════════
PDF 분석 프로세스 (6단계 심층분석)
═══════════════════════════════════════════════════════════════

【1단계: 사업 핵심 파악】
- 사업의 정책 목적과 배경
- 주무부처의 정책 방향
- 사업의 핵심 키워드

【2단계: 자격요건 완전 추출】
- 필수조건 vs 우대조건 명확히 구분
- 제외 대상 (명시적 불가 조건)
- 지역/규모/업종/업력/매출/인증 조건

【3단계: 지원내용 상세분석】
- 총 예산과 기업당 지원한도
- 정부지원 vs 기업부담 비율
- 지원항목별 한도

【4단계: 평가체계 분석】
- 평가항목 및 배점표
- 가점항목과 조건
- 평가방식 (서류/발표/현장)

【5단계: 기업 맞춤 적합성 분석】
- 자격요건 항목별 충족/미충족 판정
- 가점 획득 가능 항목
- 강점과 약점 분석

【6단계: 실전 신청전략】
- 강조해야 할 핵심 포인트
- 평가위원이 중요시하는 요소
- 흔한 탈락 사유와 회피법

═══════════════════════════════════════════════════════════════
출력 형식 (JSON) - 반드시 아래 구조 정확히 따르세요
═══════════════════════════════════════════════════════════════

{
  "programSummary": "사업의 목적, 지원대상, 지원내용, 지원규모를 포함한 종합 요약. 어떤 기업이 무엇을 얼마나 지원받을 수 있는지 명확하게 400자 내외로 작성.",
  
  "eligibility": {
    "companySize": "지원 가능한 기업 규모 조건 (예: 중소기업, 중견기업 등)",
    "businessAge": "업력 조건 (예: 3년 이상, 7년 이내, 제한없음 등)",
    "requiredCerts": ["필수로 보유해야 하는 인증 목록"],
    "regionLimit": "지역 제한사항 (전국 또는 특정 지역만)",
    "industryLimit": "업종 제한사항",
    "revenueLimit": "매출 조건",
    "otherRequirements": ["기타 자격요건 - 각각 구체적으로"]
  },
  
  "budget": {
    "totalBudget": "이 사업의 총 예산 규모",
    "perCompany": "기업당 최대 지원금액",
    "govRatio": "정부지원 비율 (%)",
    "companyRatio": "기업부담 비율 및 방식",
    "selectedCount": "선정 예정 기업 수",
    "supportDetails": "지원 가능한 비용 항목들 (인건비, 재료비, 외주비, 장비비 등)"
  },
  
  "documents": {
    "required": ["필수 제출서류 전체 목록 - 빠짐없이"],
    "optional": ["선택 또는 가점 서류 목록"],
    "tips": ["서류 준비 시 실무 팁"]
  },
  
  "schedule": {
    "applicationPeriod": "신청 접수 기간 (시작일 ~ 마감일시)",
    "applicationMethod": "신청 방법 (온라인시스템명, URL 등)",
    "reviewPeriod": "심사 진행 기간",
    "selectionDate": "최종 선정 발표 예정일",
    "executionPeriod": "사업 수행 기간"
  },
  
  "evaluation": {
    "stages": ["평가 진행 단계 (예: 서류심사 → 발표평가)"],
    "criteria": ["평가항목과 배점 (예: 기술성 30점, 사업성 25점 등)"],
    "bonusPoints": ["가점 항목과 점수 (예: 여성기업 +3점)"],
    "disqualification": ["결격/탈락 사유"]
  },
  
  "companyFit": {
    "eligible": true 또는 false,
    "fitScore": 0-100 점수,
    "strengths": [
      "이 기업의 강점 5개 - 선정에 유리한 요소를 각각 구체적으로 설명"
    ],
    "weaknesses": [
      "이 기업의 약점/보완점 - 솔직하게, 대응방안도 함께"
    ],
    "recommendation": "신청 여부에 대한 최종 의견. '강력추천/추천/신중검토/비추천' 중 하나를 선택하고, 그 이유를 전문가 관점에서 300자 내외로 구체적으로 설명. 선정 가능성, 경쟁력, 준비사항 등 포함."
  }
}

═══════════════════════════════════════════════════════════════
품질 기준
═══════════════════════════════════════════════════════════════

1. 정확성: PDF에서 추출한 정보는 100% 정확해야 함
2. 구체성: 모호한 표현 대신 구체적 수치와 내용
3. 실용성: 바로 활용 가능한 수준
4. 솔직성: 미충족 조건은 솔직하게 표시
5. 전문성: 정부지원사업 전문가다운 분석

【점수 기준】
- 90점 이상: 모든 필수요건 충족 + 다수 가점 + 경쟁력 우수 → 강력추천
- 70~89점: 필수요건 충족 + 일부 가점 → 추천
- 50~69점: 필수요건 충족 + 가점 없음 → 신중검토
- 30~49점: 일부 요건 미충족 가능성 → 신중검토
- 30점 미만: 필수요건 미충족 → 비추천

【중요】
- PDF에 없는 정보는 "확인 필요"로 표시
- 반드시 순수 JSON만 출력 (마크다운, 설명문 없이)
- 이 분석을 받는 CEO가 2,000원의 가치를 느낄 수 있도록 작성

═══════════════════════════════════════════════════════════════
분석할 공고문 내용 (PDF에서 추출)
═══════════════════════════════════════════════════════════════

${pdfText}`;

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 16384
            }
          })
        }
      );
      
      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error('Gemini API 오류:', geminiResponse.status, errorText);
        throw new Error(`Gemini API 오류: ${geminiResponse.status}`);
      }
      
      const geminiData = await geminiResponse.json();
      
      if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Gemini 응답 없음');
      }
      
      const analysisText = geminiData.candidates[0].content.parts[0].text;
      console.log('📝 AI 응답 길이:', analysisText.length);
      
      // JSON 추출
      let jsonText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let analysis;
      try {
        analysis = JSON.parse(jsonText);
      } catch (e) {
        console.error('JSON 파싱 오류:', e);
        console.error('원본 텍스트:', jsonText.substring(0, 500));
        // JSON 파싱 실패 시 기본 구조 반환
        analysis = {
          programSummary: analysisText.substring(0, 200),
          eligibility: { companySize: "확인 필요", businessAge: "확인 필요" },
          budget: { totalBudget: "확인 필요", perCompany: "확인 필요" },
          schedule: { applicationPeriod: "확인 필요" },
          companyFit: { eligible: null, fitScore: 0, recommendation: "PDF 분석에 실패했습니다. 공고문을 직접 확인해주세요." }
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

// ============================================================
// 5. 크레딧 시스템 - Firestore 기반
// ============================================================

const db = admin.firestore();

/**
 * 크레딧 조회
 */
exports.getCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      
      // Firestore에서 사용자 크레딧 조회
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      let credits;
      
      if (!userDoc.exists) {
        // 신규 사용자 - 기본 크레딧 생성
        credits = {
          freeRemaining: 10,
          paidBalance: 0,
          lastResetMonth: currentMonth,
          createdAt: new Date().toISOString()
        };
        await userRef.set(credits);
        console.log('🆕 신규 사용자 크레딧 생성:', userId);
      } else {
        credits = userDoc.data();
        
        // 월이 바뀌었으면 무료 횟수 리셋
        if (credits.lastResetMonth !== currentMonth) {
          credits.freeRemaining = 10;
          credits.lastResetMonth = currentMonth;
          await userRef.update({
            freeRemaining: 10,
            lastResetMonth: currentMonth
          });
          console.log('📅 월간 무료 횟수 리셋:', userId);
        }
      }
      
      return {
        success: true,
        credits: {
          freeRemaining: credits.freeRemaining,
          paidBalance: credits.paidBalance,
          lastResetMonth: credits.lastResetMonth
        }
      };
      
    } catch (error) {
      console.error('❌ 크레딧 조회 오류:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * 크레딧 차감
 */
exports.deductCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const userId = context.auth.uid;
      const { type } = data; // 'summary' | 'detail'
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // Firestore에서 사용자 크레딧 조회
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return { success: false, error: '사용자 정보가 없습니다.' };
      }
      
      let credits = userDoc.data();
      const originalFreeRemaining = credits.freeRemaining;
      
      // 월이 바뀌었으면 무료 횟수 리셋
      if (credits.lastResetMonth !== currentMonth) {
        credits.freeRemaining = 10;
        credits.lastResetMonth = currentMonth;
      }
      
      // 차감 처리
      let cost = 0;
      if (type === 'summary') {
        if (credits.freeRemaining > 0) {
          // 무료 사용
          credits.freeRemaining--;
          cost = 0;
          console.log(`📊 무료 요약분석 사용: ${userId}, 잔여 ${credits.freeRemaining}회`);
        } else if (credits.paidBalance >= 500) {
          // 유료 사용
          credits.paidBalance -= 500;
          cost = 500;
          console.log(`📊 유료 요약분석 사용: ${userId}, 잔액 ${credits.paidBalance}P`);
        } else {
          return { success: false, error: '포인트가 부족합니다.' };
        }
      } else if (type === 'detail') {
        if (credits.paidBalance >= 2000) {
          credits.paidBalance -= 2000;
          cost = 2000;
          console.log(`📄 상세분석 사용: ${userId}, 잔액 ${credits.paidBalance}P`);
        } else {
          return { success: false, error: '포인트가 부족합니다. (2,000P 필요)' };
        }
      } else {
        return { success: false, error: '잘못된 타입입니다.' };
      }
      
      // Firestore 업데이트
      await userRef.update({
        freeRemaining: credits.freeRemaining,
        paidBalance: credits.paidBalance,
        lastResetMonth: credits.lastResetMonth
      });
      
      // 사용 내역 기록
      await userRef.collection('usageHistory').add({
        type,
        cost,
        date: new Date().toISOString(),
        freeRemainingAfter: credits.freeRemaining,
        paidBalanceAfter: credits.paidBalance
      });
      
      return {
        success: true,
        credits: {
          freeRemaining: credits.freeRemaining,
          paidBalance: credits.paidBalance,
          lastResetMonth: credits.lastResetMonth
        }
      };
      
    } catch (error) {
      console.error('❌ 크레딧 차감 오류:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * 크레딧 충전 (관리자용)
 */
exports.addCredits = functions
  .region('asia-northeast3')
  .https.onCall(async (data, context) => {
    try {
      // 인증 확인
      if (!context.auth) {
        return { success: false, error: '로그인이 필요합니다.' };
      }
      
      const { targetUserId, amount } = data;
      
      // 관리자 확인 (이메일 기반)
      const adminEmails = ['polarislkh@naver.com', 'kfp_center@naver.com', 'polarislkh@gmail.com'];
      const callerEmail = context.auth.token.email;
      
      if (!adminEmails.includes(callerEmail)) {
        return { success: false, error: '관리자 권한이 필요합니다.' };
      }
      
      if (!targetUserId || !amount || amount <= 0) {
        return { success: false, error: '유효하지 않은 요청입니다.' };
      }
      
      // 대상 사용자 크레딧 업데이트
      const userRef = db.collection('users').doc(targetUserId);
      const userDoc = await userRef.get();
      
      let currentBalance = 0;
      if (userDoc.exists) {
        currentBalance = userDoc.data().paidBalance || 0;
        await userRef.update({
          paidBalance: currentBalance + amount
        });
      } else {
        // 신규 사용자 생성
        const currentMonth = new Date().toISOString().slice(0, 7);
        await userRef.set({
          freeRemaining: 10,
          paidBalance: amount,
          lastResetMonth: currentMonth,
          createdAt: new Date().toISOString()
        });
      }
      
      // 충전 내역 기록
      await userRef.collection('chargeHistory').add({
        amount,
        date: new Date().toISOString(),
        chargedBy: callerEmail
      });
      
      console.log(`💰 크레딧 충전: ${targetUserId}에게 ${amount}P (by ${callerEmail})`);
      
      return {
        success: true,
        message: `${amount}P가 충전되었습니다.`
      };
      
    } catch (error) {
      console.error('❌ 크레딧 충전 오류:', error);
      return { success: false, error: error.message };
    }
  });
