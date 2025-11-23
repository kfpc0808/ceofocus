// netlify/functions/analyzeBizInfo.js
// Gemini 2.5 Flash API를 사용한 기업 지원사업 매칭 분석

const fetch = require('node-fetch');
const AbortController = require('abort-controller');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // ✅ 수정: supportPrograms를 받도록 추가
    const { companyProfile, supportPrograms, model = 'gemini-2.5-flash' } = JSON.parse(event.body);

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    // ✅ 수정: 전달받은 supportPrograms 사용, 없으면 샘플 데이터
    let programs = supportPrograms;
    if (!programs || programs.length === 0) {
      console.log('⚠️ supportPrograms 없음, 샘플 데이터 사용');
      programs = getSamplePrograms();
    } else {
      console.log(`✅ HTML에서 전달받은 ${programs.length}개 지원사업 사용`);
    }

    // Gemini 2.5 Flash 프롬프트 (심층 분석 버전)
    const analysisPrompt = `
당신은 한국의 중소기업 지원사업 전문 컨설턴트입니다.
20년 경력의 전문가 수준으로 상세하고 실무적인 분석을 제공하세요.

# 기업 정보 (완전판)
${JSON.stringify(companyProfile, null, 2)}

# 지원사업 데이터 (상위 50개)
${JSON.stringify(programs.slice(0, 50), null, 2)}

# 심층 분석 요구사항

1. 기업 현황 종합 분석:
   - 강점/약점 파악
   - 성장 단계 진단
   - 재무 건전성 평가
   - 기술 경쟁력 분석

2. 최적 매칭 사업 선정 (상위 10개):
   - 매칭도 점수 (0-100, 정확하게 계산)
   - 선정 확률 예측 (%)
   - 우선순위 설정

3. 각 사업별 상세 분석:
   a) 추천 이유 (구체적 근거):
      - 왜 이 기업에 적합한지
      - 어떤 조건을 충족하는지
      - 가점 요소는 무엇인지
   
   b) 지원 내용:
      - 지원 금액/형태
      - 지원 기간
      - 혜택 상세
   
   c) 신청 전략:
      - 준비해야 할 서류
      - 보완이 필요한 부분
      - 신청 시 강조할 포인트
      - 예상 경쟁률과 대응 방안
   
   d) 주의사항:
      - 결격사유 체크
      - 마감일 확인
      - 매칭펀드 준비
   
   e) 타임라인:
      - 신청 전 준비 (1-2개월)
      - 신청 (언제)
      - 심사 기간
      - 선정 발표

4. 즉시 조치 사항:
   - 긴급하게 처리할 것
   - 인증 만료일 체크
   - 결격사유 해소

5. 장기 전략:
   - 6개월-1년 로드맵
   - 인증 취득 계획
   - 역량 강화 방안

응답은 반드시 JSON 형식으로 작성하세요.

{
  "recommendations": [
    {
      "programName": "사업명",
      "organization": "주관기관",
      "matchScore": 95,
      "estimatedProbability": "78%",
      "priority": "즉시신청|준비후신청|장기검토",
      "reason": "## 추천 이유\\n\\n1. 적격성 분석\\n- 기업규모: ○○로 조건 충족\\n- 업종: ○○로 적합\\n\\n2. 가점 요소\\n- 청년고용 33% (가점 최대)\\n- R&D 투자 15% (업계평균 8% 초과)\\n\\n3. 경쟁력\\n- 특허 3건 보유\\n- 벤처기업 인증",
      "benefits": "## 지원 내용\\n\\n- 지원금액: 최대 2억원 (정부 70% + 기업 30%)\\n- 지원기간: 12개월\\n- 추가혜택: 컨설팅 무료, 전시회 참가 지원",
      "strategy": "## 신청 전략\\n\\n### 준비 사항 (2개월)\\n1. 벤처기업 재인증 (2025.03 만료 예정)\\n2. 청년직원 1명 추가 채용 (35% 달성시 S등급)\\n3. 대학 연계 MOU 체결 (컨소시엄 가점)\\n\\n### 서류 준비\\n- 사업계획서 (기술개발 로드맵 포함)\\n- 재무제표 3개년\\n- 특허증 사본\\n\\n### 강조 포인트\\n- R&D 투자 실적 (매출의 15%)\\n- 청년고용 비율 우수\\n- 기술 차별성",
      "cautions": "⚠️ 주의사항\\n- 벤처 재인증 실패 시 대부분 탈락\\n- 매칭펀드 30% 필요 (6천만원)\\n- 국세 체납 발생 시 즉시 결격",
      "timeline": "📅 타임라인\\n- 12월: 벤처 재인증 신청\\n- 1월: 청년직원 채용\\n- 2월: 사업계획서 작성\\n- 3월 1-15일: 사업 신청\\n- 4월: 서면 심사\\n- 5월: PT 심사\\n- 6월: 선정 발표",
      "detailUrl": "https://www.k-startup.go.kr/..."
    }
  ],
  "overallAnalysis": {
    "strengths": ["강점1", "강점2"],
    "weaknesses": ["약점1", "약점2"],
    "opportunities": ["기회1", "기회2"],
    "threats": ["위험1", "위험2"]
  },
  "urgentActions": [
    "1. 벤처기업 재인증 신청 (만료 3개월 전)",
    "2. 국세/지방세 납부 확인",
    "3. 4대보험 가입 현황 점검"
  ],
  "longTermStrategy": "6개월-1년 로드맵:\\n1. Q1: 벤처 재인증, R&D 사업 신청\\n2. Q2: 청년고용 확대, 특허 1건 추가 출원\\n3. Q3: 이노비즈 인증 취득\\n4. Q4: 수출바우처 신청"
}
`;

    // Gemini 2.5 Flash API 호출
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: analysisPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          responseMimeType: "application/json"
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API 오류: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const resultText = geminiData.candidates[0].content.parts[0].text;
    const result = JSON.parse(resultText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...result,
        model: model,
        modelVersion: 'Gemini 2.5 Flash (심층 분석 모드)',
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('분석 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: '분석 중 오류가 발생했습니다.',
        message: error.message
      })
    };
  }
};

function getSamplePrograms() {
  return [
    {
      programName: "중소기업 기술개발사업",
      organization: "중소벤처기업부",
      supportAmount: "최대 2억원",
      eligibility: "벤처/이노비즈 우대, 매출 100억 이하",
      requirements: "R&D 투자 실적, 기업부설연구소",
      applicationPeriod: "2025년 1-2월",
      competitionRate: "3:1",
      detailUrl: "https://www.k-startup.go.kr/"
    },
    {
      programName: "청년친화형 강소기업",
      organization: "고용노동부",
      supportAmount: "최대 1억원",
      eligibility: "청년고용 30% 이상",
      requirements: "상시근로자 10명 이상",
      applicationPeriod: "2025년 상반기",
      competitionRate: "2:1",
      detailUrl: "https://www.work.go.kr/"
    },
    {
      programName: "소재부품장비 R&D",
      organization: "산업통상자원부",
      supportAmount: "최대 3억원",
      eligibility: "소재부품장비 전문기업",
      requirements: "연구조직, 특허 1건 이상",
      applicationPeriod: "2025년 3월",
      competitionRate: "4:1",
      detailUrl: "https://www.motie.go.kr/"
    },
    {
      programName: "여성기업 특화 지원",
      organization: "여성가족부",
      supportAmount: "최대 5천만원",
      eligibility: "여성기업 인증",
      requirements: "창업 7년 이하",
      applicationPeriod: "2025년 연중",
      competitionRate: "2:1",
      detailUrl: "https://www.mogef.go.kr/"
    },
    {
      programName: "스마트공장 구축",
      organization: "중소벤처기업부",
      supportAmount: "최대 1억원",
      eligibility: "제조업, 매출 10억 이상",
      requirements: "자체부담 30%",
      applicationPeriod: "2025년 1-12월",
      competitionRate: "1.5:1",
      detailUrl: "https://www.smart-factory.kr/"
    }
  ];
}
