/**
 * Netlify Function: 특허청 API 호출
 * 경로: /.netlify/functions/getPatent
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // CORS 헤더 설정
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONS 요청 처리 (CORS preflight)
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
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 요청 데이터 파싱
    const { companyName } = JSON.parse(event.body);

    if (!companyName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          message: '회사명이 필요합니다.' 
        })
      };
    }

    console.log(`특허청 API 호출: ${companyName}`);

    // 환경 변수에서 API 키 가져오기
    const API_KEY = process.env.OPEN_API_KEY;
    
    if (!API_KEY) {
      console.error('API 키가 설정되지 않았습니다.');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          message: 'API 키가 설정되지 않았습니다.',
          totalCount: 0,
          patents: []
        })
      };
    }

    // 특허청 API 호출
    const apiUrl = `https://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getWordSearch?` +
      `serviceKey=${encodeURIComponent(API_KEY)}&` +
      `word=${encodeURIComponent(companyName)}&` +
      `docsStart=1&` +
      `docsCount=20`;

    const response = await fetch(apiUrl);
    const xmlText = await response.text();

    // XML 파싱을 위한 간단한 정규식 사용
    const resultCodeMatch = xmlText.match(/<resultCode>([^<]+)<\/resultCode>/);
    const resultCode = resultCodeMatch ? resultCodeMatch[1] : null;

    if (resultCode !== '00') {
      console.log(`특허청 API 응답 코드: ${resultCode}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          message: '특허 정보를 찾을 수 없습니다.',
          totalCount: 0,
          patents: []
        })
      };
    }

    // item 태그들 추출
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const items = [];
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemXml = match[1];
      
      // 각 필드 추출
      const getField = (fieldName) => {
        const regex = new RegExp(`<${fieldName}>([^<]*)<\/${fieldName}>`, 'i');
        const match = itemXml.match(regex);
        return match ? match[1].trim() : '';
      };

      const patent = {
        title: getField('inventionTitle') || getField('inventionTitleKor'),
        applicationNumber: getField('applicationNumber'),
        registrationNumber: getField('registrationNumber'),
        applicant: getField('applicantName'),
        applicationDate: getField('applicationDate'),
        registrationDate: getField('registrationDate')
      };

      // 회사명이 출원인에 포함되어 있는지 확인
      if (patent.applicant && patent.applicant.includes(companyName)) {
        items.push(patent);
      } else if (items.length < 10) {
        // 관련 특허도 일부 포함 (최대 10건)
        items.push(patent);
      }
    }

    console.log(`특허 검색 완료: ${items.length}건`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalCount: items.length,
        patents: items,
        companyName: companyName
      })
    };

  } catch (error) {
    console.error('특허청 API 오류:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: '특허 정보 조회 중 오류가 발생했습니다: ' + error.message,
        totalCount: 0,
        patents: []
      })
    };
  }
};
