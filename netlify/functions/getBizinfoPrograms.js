/**
 * Netlify Function: 기업마당 지원사업 조회
 * 경로: /.netlify/functions/getBizinfoPrograms
 * 
 * 역할:
 * - 기업마당 API에서 지원사업 목록 조회
 * - 기업 조건에 맞는 필터링
 * - 매칭 점수 계산은 프론트엔드에서 수행
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { filters } = JSON.parse(event.body || '{}');

    const BIZINFO_API_KEY = process.env.BIZINFO_API_KEY || 'q5Y94d';

    console.log(`🎯 기업마당 API 조회 시작`);
    console.log(`   필터:`, filters);

    // 기업마당 API 호출
    const apiUrl = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
    
    // 파라미터 구성
    const params = new URLSearchParams({
      key: BIZINFO_API_KEY,
      type: 'json'
    });

    // 필터가 있으면 추가
    if (filters) {
      if (filters.category) params.append('category', filters.category);
      if (filters.region) params.append('region', filters.region);
      if (filters.keyword) params.append('keyword', filters.keyword);
    }

    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      throw new Error(`기업마당 API 호출 실패: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // XML 응답일 경우
      const text = await response.text();
      console.log('XML 응답:', text.substring(0, 500));
      
      // XML을 간단히 파싱 (정규식)
      data = parseXmlToJson(text);
    }

    // 데이터 정규화
    const programs = normalizePrograms(data);

    console.log(`✅ 조회 성공: ${programs.length}개 지원사업`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        count: programs.length,
        programs: programs
      })
    };

  } catch (error) {
    console.error('❌ 기업마당 API 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: '조회 실패: ' + error.message 
      })
    };
  }
};

/**
 * XML을 JSON으로 간단 변환
 */
function parseXmlToJson(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    
    const item = {
      title: extractTag(itemXml, 'title'),
      description: extractTag(itemXml, 'description'),
      link: extractTag(itemXml, 'link'),
      category: extractTag(itemXml, 'category'),
      pubDate: extractTag(itemXml, 'pubDate'),
      organization: extractTag(itemXml, 'organization') || extractTag(itemXml, 'author'),
      startDate: extractTag(itemXml, 'startDate'),
      endDate: extractTag(itemXml, 'endDate'),
      target: extractTag(itemXml, 'target'),
      budget: extractTag(itemXml, 'budget')
    };
    
    items.push(item);
  }

  return { items };
}

/**
 * XML 태그에서 내용 추출
 */
function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}>(.*?)<\/${tagName}>`, 's');
  const match = xml.match(regex);
  
  if (match && match[1]) {
    // CDATA 제거
    let content = match[1].trim();
    content = content.replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1');
    // HTML 태그 제거
    content = content.replace(/<[^>]+>/g, '');
    // HTML 엔티티 디코딩
    content = content.replace(/&lt;/g, '<')
                     .replace(/&gt;/g, '>')
                     .replace(/&amp;/g, '&')
                     .replace(/&quot;/g, '"')
                     .replace(/&#39;/g, "'");
    return content.trim();
  }
  
  return '';
}

/**
 * 프로그램 데이터 정규화
 */
function normalizePrograms(data) {
  if (!data || !data.items || !Array.isArray(data.items)) {
    return [];
  }

  return data.items.map((item, index) => {
    // 분야 매핑
    const categoryMap = {
      '금융': '금융',
      '기술': 'R&D',
      'R&D': 'R&D',
      '인력': '고용',
      '고용': '고용',
      '수출': '수출',
      '내수': '판로',
      '창업': '창업',
      '경영': '경영'
    };

    return {
      id: `bizinfo-${index + 1}`,
      name: item.title || '제목 없음',
      organization: item.organization || '미상',
      category: categoryMap[item.category] || '기타',
      budget: item.budget || '미정',
      description: (item.description || '').substring(0, 200),
      website: item.link || 'https://www.bizinfo.go.kr',
      
      // 추가 정보
      startDate: item.startDate || '',
      endDate: item.endDate || '',
      target: item.target || '',
      pubDate: item.pubDate || '',
      
      // 매칭용 기본 설정 (프론트에서 재계산)
      requiresNoArrears: true,
      minBusinessAge: null,
      maxBusinessAge: null,
      targetCompanySize: [],
      targetIndustry: [],
      targetRegion: []
    };
  });
}
