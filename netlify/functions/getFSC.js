/**
 * Netlify Function: 금융위원회 기업개요 조회 API 프록시
 * 경로: /.netlify/functions/getFSC
 * 
 * 역할:
 * - 법인번호로 기업 정보 조회
 * - 매출액, 자산, 부채 등 재무 정보 제공
 */

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // CORS preflight 요청 처리
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
    const { corpNumber } = JSON.parse(event.body);

    if (!corpNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: '법인번호를 입력해주세요.' 
        })
      };
    }

    const API_KEY = process.env.API_KEY;

    if (!API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          message: 'API Key가 설정되지 않았습니다.' 
        })
      };
    }

    const cleanCN = corpNumber.replace(/-/g, '');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    console.log(`🏛️ 금융위 API 조회: ${cleanCN}`);

    // 금융위원회 API 호출
    const response = await fetch(
      `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${API_KEY}&numOfRows=1&pageNo=1&resultType=json&crno=${cleanCN}&bsnsYear=${today.slice(0, 4)}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    const result = await response.json();

    // 응답 처리
    if (result.response?.body?.items?.item) {
      const items = result.response.body.items.item;
      const data = Array.isArray(items) ? items[0] : items;

      console.log(`✅ 조회 성공: ${data.corpNm || '알 수 없음'}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          companyName: data.corpNm || '',
          ceo: data.ceoNm || '',
          establishDate: data.estbDt || '',
          employees: data.enpBsacdeCnt || '',
          revenue: data.enpSizeNm || '',
          assets: data.totAsset || '',
          debt: data.totDebt || '',
          capital: data.capl || ''
        })
      };
    } else {
      console.log(`❌ 조회 실패: ${cleanCN}`);
      
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: false, 
          message: '법인 정보를 찾을 수 없습니다.' 
        })
      };
    }

  } catch (error) {
    console.error('❌ 금융위 API 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: 'API 호출 실패: ' + error.message 
      })
    };
  }
};
