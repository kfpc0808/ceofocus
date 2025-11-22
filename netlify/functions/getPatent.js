/**
 * Netlify Function: 특허청 API 프록시 (KIPRIS)
 * 경로: /.netlify/functions/getPatent
 * 
 * 역할:
 * - 회사명으로 특허 검색
 * - 특허/실용신안 정보 조회
 */

const fetch = require('node-fetch');
const xml2js = require('xml2js');

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
    const { companyName } = JSON.parse(event.body);

    if (!companyName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: '회사명을 입력해주세요.' 
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

    console.log(`📜 특허청 API 조회: ${companyName}`);

    // 특허청 API 호출 (KIPRIS)
    const response = await fetch(
      `https://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getWordSearch?` +
      `serviceKey=${encodeURIComponent(API_KEY)}&` +
      `word=${encodeURIComponent(companyName)}&` +
      `docsStart=1&` +
      `docsCount=10`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/xml'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }

    const xmlText = await response.text();

    // XML to JSON 파싱
    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true
    });

    const result = await parser.parseStringPromise(xmlText);

    // 응답 처리
    if (result.response && result.response.header.resultCode === '00') {
      const body = result.response.body;
      
      if (body && body.items && body.items.item) {
        let items = body.items.item;
        
        // 단일 결과를 배열로 변환
        if (!Array.isArray(items)) {
          items = [items];
        }

        const patents = items.map(item => ({
          title: item.inventionTitle || '',
          applicationNumber: item.applicationNumber || '',
          registrationNumber: item.registrationNumber || '',
          applicant: item.applicantName || '',
          applicationDate: item.applicationDate || '',
          registrationDate: item.registrationDate || '',
          status: item.status || ''
        }));

        console.log(`✅ 조회 성공: ${patents.length}건`);

        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            totalCount: patents.length,
            patents: patents
          })
        };
      }
    }

    console.log(`❌ 조회 실패: 특허 없음`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        message: '특허 정보를 찾을 수 없습니다.',
        totalCount: 0,
        patents: []
      })
    };

  } catch (error) {
    console.error('❌ 특허청 API 오류:', error);
    
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
