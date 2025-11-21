// Netlify Function - 기업마당 AI 매칭 시스템
// netlify/functions/analyzeBizInfo.js

const fetch = require('node-fetch');

// ✅ API 키 (환경 변수 또는 직접 입력)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDjS3bsIsl3uDtyQIrzpZTO3IigLmLNG1E";
const BIZINFO_API_KEY = "q5Y94d";

// Netlify Function Handler
exports.handler = async (event, context) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONS 요청 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // POST 요청만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // 요청 데이터 파싱
    const { companyProfile } = JSON.parse(event.body);
    
    if (!companyProfile) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '기업 정보가 없습니다.' })
      };
    }

    console.log('[분석 시작]:', companyProfile.companyName);

    // 1. 기업마당 API 호출
    const allPrograms = await fetchBizInfoPrograms();
    console.log(`[기업마당] ${allPrograms.length}개 발견`);

    // 2. 로컬 필터링
    const filtered = localFilter(allPrograms, companyProfile);
    console.log(`[필터링] ${filtered.length}개로 축소`);

    // 3. Gemini 분석
    const geminiResult = await analyzeWithGemini(companyProfile, filtered);
    console.log(`[Gemini] ${geminiResult.recommendations.length}개 추천`);

    // 4. 결과 반환
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalPrograms: allPrograms.length,
        filteredPrograms: filtered.length,
        recommendations: geminiResult.recommendations,
        analysisTime: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('[오류]:', error);
    
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

// ============================================
// 기업마당 API 호출
// ============================================
async function fetchBizInfoPrograms() {
  const url = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${BIZINFO_API_KEY}`;
  
  const response = await fetch(url, {
    method: 'GET',
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`기업마당 API 오류: ${response.status}`);
  }

  const xmlText = await response.text();
  return parseXMLPrograms(xmlText);
}

// ============================================
// XML 파싱
// ============================================
function parseXMLPrograms(xmlText) {
  const programs = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    
    const program = {
      name: extractTag(itemXml, 'title') || extractTag(itemXml, 'pblancNm'),
      id: extractTag(itemXml, 'seq') || extractTag(itemXml, 'pblancId'),
      organization: extractTag(itemXml, 'jrsdInsttNm') || extractTag(itemXml, 'author'),
      executor: extractTag(itemXml, 'excInsttNm'),
      category: extractTag(itemXml, 'pldirSportRealmLclasCodeNm') || extractTag(itemXml, 'lcategory'),
      target: extractTag(itemXml, 'trgetNm'),
      period: extractTag(itemXml, 'reqstBeginEndDe') || extractTag(itemXml, 'reqstDt'),
      description: extractTag(itemXml, 'bsnsSumryCn') || extractTag(itemXml, 'description'),
      url: extractTag(itemXml, 'pblancUrl') || extractTag(itemXml, 'link'),
      date: extractTag(itemXml, 'creatPnttm') || extractTag(itemXml, 'pubDate'),
      hashTags: extractTag(itemXml, 'hashTags')
    };

    if (program.name && program.organization) {
      programs.push(program);
    }
  }

  return programs;
}

function extractTag(xml, tagName) {
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  let match = xml.match(cdataRegex);
  if (match) return cleanText(match[1]);

  const normalRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  match = xml.match(normalRegex);
  if (match) return cleanText(match[1]);

  return '';
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

// ============================================
// 로컬 필터링
// ============================================
function localFilter(programs, profile) {
  const filtered = programs.filter(program => {
    if (program.target) {
      const hasSize = program.target.includes(profile.size) ||
                     program.target.includes('전체') ||
                     program.target.includes('무관');
      if (!hasSize) return false;
    }

    if (program.hashTags && profile.location) {
      const tags = program.hashTags.toLowerCase();
      const location = profile.location.toLowerCase();
      const isNational = tags.includes('전국') || tags.includes('무관');
      const isLocal = tags.includes(location);
      if (!isNational && !isLocal) return false;
    }

    if (program.category && profile.industry) {
      const categoryMatch = program.category.includes(profile.industry) ||
                           program.category === '전체' ||
                           program.category === '공통';
      if (!categoryMatch) {
        if (program.hashTags) {
          const hasIndustry = program.hashTags.includes(profile.industry);
          if (!hasIndustry) return false;
        } else {
          return false;
        }
      }
    }

    return true;
  });

  return filtered
    .sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    })
    .slice(0, 80);
}

// ============================================
// Gemini 2.0 Flash 분석
// ============================================
async function analyzeWithGemini(profile, programs) {
  const prompt = createAnalysisPrompt(profile, programs);
  
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
  
  const response = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 오류 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.candidates || !data.candidates[0]) {
    throw new Error('Gemini 응답 형식 오류');
  }

  const resultText = data.candidates[0].content.parts[0].text;
  
  try {
    return JSON.parse(resultText);
  } catch (e) {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Gemini 응답 파싱 실패');
  }
}

// ============================================
// 프롬프트 생성
// ============================================
function createAnalysisPrompt(profile, programs) {
  return `당신은 한국 정부 지원사업 전문 컨설턴트입니다.
다음 기업 정보를 분석하여 가장 적합한 지원사업을 최대 8개까지 추천해주세요.

# 기업 정보
- 회사명: ${profile.companyName}
- 업종: ${profile.industry}
- 소재지: ${profile.location}
- 기업규모: ${profile.size}
- 매출액: ${profile.revenue}
- 업력: ${profile.experience}년
${profile.certifications?.length ? `- 인증: ${profile.certifications.join(', ')}` : ''}
${profile.goals?.length ? `- 목표: ${profile.goals.join(', ')}` : ''}
${profile.totalEmployees ? `- 총 직원: ${profile.totalEmployees}명` : ''}
${profile.youngEmployees ? `- 청년직원: ${profile.youngEmployees}명` : ''}

# 후보 지원사업 (${programs.length}개)
${JSON.stringify(programs, null, 2)}

# 출력 형식 (반드시 JSON만)
{
  "recommendations": [
    {
      "rank": 1,
      "programName": "정확한 사업명",
      "organization": "주관기관",
      "matchScore": 95,
      "reason": "이 기업에 추천하는 구체적이고 상세한 이유 (4-5문장)",
      "benefits": "지원 내용 및 예상 금액",
      "cautions": "주의사항, 필수 준비사항",
      "applicationPeriod": "신청기간",
      "detailUrl": "상세 URL",
      "priority": "즉시신청|준비후신청|장기검토"
    }
  ]
}

# 분석 기준
1. 신청 자격 완벽 충족 여부
2. 인증 및 기업 규모 적합성
3. 업종 및 지역 매칭도
4. 지원 금액 및 실질적 혜택
5. 현실적인 선정 가능성

매칭도가 80점 이상인 것만, 높은 순서로 최대 8개 추천하세요.`;
}
