/**
 * Netlify Function: 메인비즈 인증 조회 (크롤링)
 * 경로: /.netlify/functions/getMainbiz
 * 
 * 역할:
 * - 중소기업중앙회 메인비즈 사이트 크롤링
 * - 회사명으로 메인비즈 인증 확인
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

    console.log(`🏢 메인비즈 조회 시작: ${companyName}`);

    // 메인비즈 검색 API 호출
    const searchUrl = 'https://www.smes.go.kr/mainbiz/usr/innovation/list.do';
    
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      },
      body: `searchWord=${encodeURIComponent(companyName)}&pageIndex=1`
    });

    if (!response.ok) {
      throw new Error(`검색 실패: ${response.status}`);
    }

    const html = await response.text();

    // HTML 파싱 (간단한 정규식)
    const companyMatch = html.match(new RegExp(`${companyName}[^<]*</`));
    
    if (companyMatch) {
      // 인증 정보 추출
      const dateMatch = html.match(/(\d{4})-(\d{2})-(\d{2})/);
      const regionMatch = html.match(/>([가-힣]+시|[가-힣]+도)</);
      const typeMatch = html.match(/>(주력산업|일반)</);

      console.log(`✅ 조회 성공: ${companyName}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          companyName: companyName,
          certified: true,
          region: regionMatch ? regionMatch[1] : '',
          certType: typeMatch ? typeMatch[1] : '일반',
          expiryDate: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '',
          isValid: true
        })
      };
    }

    console.log(`❌ 조회 실패: 메인비즈 인증 없음`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        certified: false,
        message: '메인비즈 인증 정보 없음' 
      })
    };

  } catch (error) {
    console.error('❌ 메인비즈 조회 오류:', error);
    
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
