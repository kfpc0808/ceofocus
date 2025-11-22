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
    
    // 분야 매핑 (한글 → 코드)
    const categoryMap = {
      '금융': '01',
      '기술': '02',
      'R&D': '02',
      '인력': '03',
      '고용': '03',
      '수출': '04',
      '내수': '05',
      '판로': '05',
      '창업': '06',
      '경영': '07',
      '기타': '09'
    };
    
    // 파라미터 구성 (정확한 파라미터명 사용!)
    const params = new URLSearchParams({
      crtfcKey: BIZINFO_API_KEY,  // 서비스키
      dataType: 'json',            // 데이터타입
      searchCnt: '100'             // 조회건수
    });

    // 필터가 있으면 추가
    if (filters) {
      // 분야 필터
      if (filters.category) {
        const categoryCode = categoryMap[filters.category] || '06'; // 기본값: 창업
        params.append('searchLclasId', categoryCode);
      }
      
      // 해시태그 (지역, 키워드 등)
      const hashtags = [];
      if (filters.region) hashtags.push(filters.region);
      if (filters.keyword) hashtags.push(filters.keyword);
      if (hashtags.length > 0) {
        params.append('hashtags', hashtags.join(','));
      }
    }
    
    console.log('🎯 기업마당 API 호출:', apiUrl);
    console.log('📋 파라미터:', params.toString());

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
      console.log('📦 JSON 응답 받음');
    } else {
      // XML 응답일 경우
      const text = await response.text();
      console.log('📦 XML 응답 받음');
      
      // XML을 JSON으로 파싱
      data = parseXmlToJson(text);
    }

    // 기업마당 API는 JSON 응답을 jsonArray로 감싼다
    if (data.jsonArray) {
      data = data.jsonArray;
      console.log('📦 jsonArray 언래핑');
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
 * XML을 JSON으로 간단 변환
 */
function parseXmlToJson(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    
    const item = {
      // 기업마당 API 정확한 필드명
      title: extractTag(itemXml, 'title') || extractTag(itemXml, 'pblancNm'),
      description: extractTag(itemXml, 'description') || extractTag(itemXml, 'bsnsSumryCn'),
      link: extractTag(itemXml, 'link') || extractTag(itemXml, 'pblancUrl'),
      seq: extractTag(itemXml, 'seq') || extractTag(itemXml, 'pblancId'),
      author: extractTag(itemXml, 'author') || extractTag(itemXml, 'jrsdInsttNm'),
      excInsttNm: extractTag(itemXml, 'excInsttNm'),
      lcategory: extractTag(itemXml, 'lcategory') || extractTag(itemXml, 'pldirSportRealmLclasCodeNm'),
      pubDate: extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'creatPnttm'),
      reqstDt: extractTag(itemXml, 'reqstDt') || extractTag(itemXml, 'reqstBeginEndDe'),
      trgetNm: extractTag(itemXml, 'trgetNm')
    };
    
    items.push(item);
  }

  console.log(`📊 XML 파싱: ${items.length}개 항목`);
  return { item: items };
}

/**
 * 프로그램 데이터 정규화
 */
function normalizePrograms(data) {
  // JSON 응답의 경우 item 또는 items 배열
  let items = [];
  
  if (data && data.item) {
    items = Array.isArray(data.item) ? data.item : [data.item];
  } else if (data && data.items) {
    items = Array.isArray(data.items) ? data.items : [data.items];
  }
  
  console.log(`📊 기업마당 원본 데이터: ${items.length}개`);
  
  if (items.length === 0) {
    return [];
  }

  return items.map((item, index) => {
    // 분야 매핑
    const categoryMap = {
      '금융': '금융',
      '기술': 'R&D',
      '인력': '고용',
      '수출': '수출',
      '내수': '판로',
      '창업': '창업',
      '경영': '경영',
      '기타': '기타'
    };

    return {
      id: `bizinfo-${item.seq || index + 1}`,
      name: item.title || item.pblancNm || '제목 없음',
      organization: item.author || item.jrsdInsttNm || '미상',
      category: categoryMap[item.lcategory || item.pldirSportRealmLclasCodeNm] || '기타',
      budget: '상세 페이지 참조',
      description: (item.description || item.bsnsSumryCn || '').replace(/<[^>]+>/g, '').substring(0, 200),
      website: item.link || item.pblancUrl || 'https://www.bizinfo.go.kr',
      
      // 추가 정보
      reqstPeriod: item.reqstDt || item.reqstBeginEndDe || '',
      startDate: (item.reqstDt || item.reqstBeginEndDe || '').split(' ~ ')[0] || '',
      endDate: (item.reqstDt || item.reqstBeginEndDe || '').split(' ~ ')[1] || '',
      target: item.trgetNm || '',
      pubDate: item.pubDate || item.creatPnttm || '',
      executor: item.excInsttNm || '',
      
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
