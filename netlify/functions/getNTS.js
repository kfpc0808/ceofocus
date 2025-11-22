/**
 * Netlify Function: 국세청 사업자 상태 조회 API 프록시
 * 경로: /.netlify/functions/getNTS
 * 
 * 역할:
 * - 브라우저에서 CORS 없이 국세청 API 호출 가능
 * - API Key를 환경변수로 안전하게 보관
 * - 전국 모든 사업자번호 조회 가능
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

  // POST 요청만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 요청 데이터 파싱
    const { businessNumber } = JSON.parse(event.body);

    if (!businessNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: '사업자번호를 입력해주세요.' 
        })
      };
    }

    // 환경변수에서 API Key 가져오기
    const API_KEY = process.env.API_KEY;

    if (!API_KEY) {
      console.error('❌ API_KEY 환경변수가 설정되지 않았습니다.');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          success: false, 
          message: 'API Key가 설정되지 않았습니다.' 
        })
      };
    }

    // 사업자번호 정제 (하이픈 제거)
    const cleanBN = businessNumber.replace(/-/g, '');

    console.log(`🔍 국세청 API 조회: ${cleanBN}`);

    // 국세청 API 호출
    const response = await fetch(
      `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          b_no: [cleanBN]
        })
      }
    );

    const result = await response.json();

    // 응답 처리
    if (result.status_code === 'OK' && result.data && result.data.length > 0) {
      const data = result.data[0];
      
      console.log(`✅ 조회 성공: ${data.b_nm}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          companyName: data.b_nm || '',
          ceo: data.p_nm || '',
          businessStatus: data.b_stt || '',
          taxType: data.tax_type || '',
          address: data.b_adr || '',
          startDate: data.start_dt || '',
          rbfTaxType: data.rbf_tax_type || '',
          rbfTaxTypeCd: data.rbf_tax_type_cd || ''
        })
      };
    } else {
      console.log(`❌ 조회 실패: ${cleanBN}`);
      
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: false, 
          message: '사업자 정보를 찾을 수 없습니다.' 
        })
      };
    }

  } catch (error) {
    console.error('❌ 국세청 API 오류:', error);
    
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
