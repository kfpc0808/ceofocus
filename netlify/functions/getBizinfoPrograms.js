/**
 * 기업마당 API 조회 함수
 * - 500개 공고 조회
 * - 페이지네이션 지원
 * - 전체 필드 포함
 */

const fetch = require('node-fetch');

exports.handler = async (event) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // OPTIONS 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { filters } = JSON.parse(event.body || '{}');

    const BIZINFO_API_KEY = process.env.BIZINFO_API_KEY || 'q5Y94d';

    console.log(`🎯 기업마당 API 조회 시작`);

    const apiUrl = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
    
    const categoryMap = {
      '금융': '01', '기술': '02', 'R&D': '02',
      '인력': '03', '고용': '03', '수출': '04',
      '내수': '05', '판로': '05', '창업': '06',
      '경영': '07', '기타': '09'
    };
    
    const params = new URLSearchParams({
      crtfcKey: BIZINFO_API_KEY,
      dataType: 'json',
      searchCnt: '500',
      pageUnit: '500',
      pageIndex: '1'
    });

    if (filters?.category) {
      const categoryCode = categoryMap[filters.category];
      if (categoryCode) params.append('searchLclasId', categoryCode);
    }
    
    const hashtags = [];
    if (filters?.region) hashtags.push(filters.region);
    if (filters?.keyword) hashtags.push(filters.keyword);
    if (hashtags.length > 0) params.append('hashtags', hashtags.join(','));
    
    const response = await fetch(`${apiUrl}?${params.toString()}`);
    if (!response.ok) throw new Error(`API 오류: ${response.status}`);

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType?.includes('xml')) {
      data = parseXmlToJson(await response.text());
    } else {
      data = await response.json();
    }

    const programs = normalizePrograms(data);
    
    console.log(`✅ ${programs.length}개 프로그램 조회 완료`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, programs, total: programs.length })
    };

  } catch (error) {
    console.error('❌ 오류:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message, programs: [] })
    };
  }
};

function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}>(.*?)<\/${tagName}>`, 's');
  const match = xml.match(regex);
  if (match && match[1]) {
    let content = match[1].trim()
      .replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return content.trim();
  }
  return '';
}

function parseXmlToJson(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title') || extractTag(itemXml, 'pblancNm'),
      description: extractTag(itemXml, 'description') || extractTag(itemXml, 'bsnsSumryCn'),
      link: extractTag(itemXml, 'link') || extractTag(itemXml, 'pblancUrl'),
      seq: extractTag(itemXml, 'seq') || extractTag(itemXml, 'pblancId'),
      author: extractTag(itemXml, 'author') || extractTag(itemXml, 'jrsdInsttNm'),
      excInsttNm: extractTag(itemXml, 'excInsttNm'),
      lcategory: extractTag(itemXml, 'lcategory') || extractTag(itemXml, 'pldirSportRealmLclasCodeNm'),
      pubDate: extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'creatPnttm'),
      reqstDt: extractTag(itemXml, 'reqstDt') || extractTag(itemXml, 'reqstBeginEndDe'),
      trgetNm: extractTag(itemXml, 'trgetNm'),
      reqstMthPapersCn: extractTag(itemXml, 'reqstMthPapersCn'),
      refrncNm: extractTag(itemXml, 'refrncNm'),
      rceptEngnHmpgUrl: extractTag(itemXml, 'rceptEngnHmpgUrl'),
      hashTags: extractTag(itemXml, 'hashTags'),
      printFlpthNm: extractTag(itemXml, 'printFlpthNm'),
      printFileNm: extractTag(itemXml, 'printFileNm')
    });
  }
  return { item: items };
}

function normalizePrograms(data) {
  let items = [];
  if (data?.item) items = Array.isArray(data.item) ? data.item : [data.item];
  else if (data?.items) items = Array.isArray(data.items) ? data.items : [data.items];
  else if (data?.jsonArray) items = Array.isArray(data.jsonArray) ? data.jsonArray : [data.jsonArray];
  
  if (items.length === 0) return [];

  const categoryMap = {
    '금융': '금융', '기술': 'R&D', '인력': '고용',
    '수출': '수출', '내수': '판로', '창업': '창업',
    '경영': '경영', '기타': '기타'
  };

  return items.map((item, index) => {
    const reqstPeriod = item.reqstDt || item.reqstBeginEndDe || '';
    const dates = reqstPeriod.split('~').map(d => d.trim());
    
    return {
      id: `bizinfo-${item.seq || item.pblancId || index + 1}`,
      name: item.title || item.pblancNm || '제목 없음',
      organization: item.author || item.jrsdInsttNm || '미상',
      executor: item.excInsttNm || '',
      category: categoryMap[item.lcategory || item.pldirSportRealmLclasCodeNm] || '기타',
      description: (item.description || item.bsnsSumryCn || '').replace(/<[^>]+>/g, ''),
      website: item.link || item.pblancUrl || 'https://www.bizinfo.go.kr',
      reqstPeriod,
      startDate: dates[0] || '',
      endDate: dates[1] || '',
      target: item.trgetNm || '',
      applicationMethod: (item.reqstMthPapersCn || '').replace(/<[^>]+>/g, ''),
      contactInfo: (item.refrncNm || '').replace(/<[^>]+>/g, ''),
      applicationUrl: item.rceptEngnHmpgUrl || '',
      hashTags: item.hashTags || '',
      pdfUrl: item.printFlpthNm || '',
      pdfFileName: item.printFileNm || ''
    };
  });
}
