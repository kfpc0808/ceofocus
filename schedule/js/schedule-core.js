/* ========================================
   일정관리 핵심 로직
   - 구글 드라이브 연동
   - AES 암호화/복호화
   - 데이터 관리
======================================== */

// ========================================
// 전역 변수
// ========================================
let calendarData = {
    schedules: [],
    todos: [],  // 할일 목록
    colorSettings: {
        '상령일': '#FF6B6B',
        '보험만기일': '#FF9500',
        '생일': '#9B59B6',
        '결혼기념일': '#FFB6C1',
        '미팅': '#FFFFFF',  // 흰색 배경
        '상담': '#6BCF7F',
        '기타': '#95a5a6'
    },
    userSettings: {
        defaultView: 'timeGridFiveDays',
        startTime: '00:00',
        endTime: '23:59',
        slotDuration: '00:30:00'
    },
    userInfo: {
        name: '홍길동',           // ⚠️ 여기에 사용자 이름 입력
        title: '지점장',          // ⚠️ 여기에 직책 입력 (선택)
        enableLinkFields: false,  // 링크 메시지 필드 활성화 여부
        kakaoMessage: '자세한 내용은 연락주시기 바랍니다.',  // 카카오톡 공유 하단 메시지
        kakaoUrlTitle: '상세보기', // 카카오톡 공유 링크 제목
        kakaoUrl: ''              // 카카오톡 공유 링크 URL (선택)
    }
};

let accessToken = null;
let tokenClient = null;
let gisInited = false;
let isConnected = false;
let autoSaveTimer = null;
let currentEditingEvent = null;

// ========================================
// Google Drive 설정
// ========================================
const GOOGLE_CLIENT_ID = "288996084140-0eo93heqd66hqhg0fh1rbum6scnt3757.apps.googleusercontent.com";
const GOOGLE_API_KEY = "AIzaSyAVtAzm9UjgGB1pqChvGvGKH7RpH0KCiVM";
const ENCRYPTION_KEY = "K7mP9nR4sT2vX8wY3zA6bC1dE5fG0hJ9";

// ========================================
// Kakao 설정
// ========================================
const KAKAO_APP_KEY = "1ada66397913195f6a7512567faa5fac"; // ✅ 카카오 JavaScript 키

// Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyDbufefZCVqCY8QQppcdQFoqVFpMriv1m0",
    authDomain: "kfpc-company-support-project.firebaseapp.com",
    databaseURL: "https://kfpc-company-support-project-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kfpc-company-support-project",
    storageBucket: "kfpc-company-support-project.firebasestorage.app",
    messagingSenderId: "1012609333373",
    appId: "1:1012609333373:web:ffba9039a7f9568356d914",
    measurementId: "G-Y757PLYBEE"
};

// Firebase 초기화
let firebaseAuth = null;
try {
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        firebaseAuth = firebase.auth();
    }
} catch (error) {
    console.warn('Firebase 초기화 실패:', error);
}

// ========================================
// 암호화 함수
// ========================================
const encryptData = (data) => {
    return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
};

const decryptData = (encryptedData) => {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
};

// ========================================
// 로그인 상태 관리
// ========================================
const saveLoginState = () => {
    if (accessToken) {
        localStorage.setItem('googleAccessToken', accessToken);
        localStorage.setItem('tokenExpiry', Date.now() + 3600000);
    }
};

const restoreLoginState = () => {
    const token = localStorage.getItem('googleAccessToken');
    const expiry = localStorage.getItem('tokenExpiry');
    
    if (token && expiry && Date.now() < parseInt(expiry)) {
        accessToken = token;
        return true;
    }
    
    localStorage.removeItem('googleAccessToken');
    localStorage.removeItem('tokenExpiry');
    return false;
};

// ========================================
// Google Identity Services 초기화
// ========================================
const initGoogleDrive = async () => {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 50;
        
        const checkGIS = setInterval(() => {
            attempts++;
            if (window.google && window.google.accounts) {
                clearInterval(checkGIS);
                
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly',
                    callback: (response) => {
                        if (response.error) {
                            console.error('❌ 인증 오류:', response.error);
                            showToast('Google 로그인 실패', 'error');
                        } else {
                            accessToken = response.access_token;
                            saveLoginState();
                            gisInited = true;
                            console.log('✅ Google Drive 인증 완료');
                            onDriveConnected();
                        }
                    },
                });
                
                gisInited = true;
                resolve();
            }
            
            if (attempts >= maxAttempts) {
                clearInterval(checkGIS);
                console.error('❌ Google Identity Services 로드 실패');
                resolve();
            }
        }, 100);
    });
};

// ========================================
// Drive 접근 권한 요청
// ========================================
const requestDriveAccess = async () => {
    // 이미 저장된 토큰이 있으면 확인
    const savedToken = localStorage.getItem('googleAccessToken');
    const expiry = localStorage.getItem('tokenExpiry');
    
    if (savedToken && expiry && Date.now() < parseInt(expiry)) {
        accessToken = savedToken;
        return true;
    }
    
    if (!gisInited) {
        await initGoogleDrive();
    }
    
    return new Promise((resolve) => {
        tokenClient.callback = async (response) => {
            if (response.error) {
                console.error('권한 요청 오류:', response.error);
                resolve(false);
            } else {
                accessToken = response.access_token;
                saveLoginState();
                resolve(true);
            }
        };
        
        tokenClient.requestAccessToken({ prompt: 'consent' });
    });
};

// ========================================
// 파일 검색
// ========================================
const findFile = async (filename) => {
    if (!accessToken) return null;
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${filename}'&fields=files(id,name,modifiedTime)`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        const data = await response.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    } catch (error) {
        console.error('파일 검색 오류:', error);
        return null;
    }
};

// ========================================
// 드라이브에 업로드
// ========================================
const uploadToDrive = async (filename, content) => {
    if (!accessToken) return null;
    
    try {
        const metadata = {
            name: filename,
            mimeType: 'text/plain'
        };
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([content], { type: 'text/plain' }));
        
        const response = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                body: form
            }
        );
        
        return await response.json();
    } catch (error) {
        console.error('업로드 오류:', error);
        return null;
    }
};

// ========================================
// 드라이브에서 다운로드
// ========================================
const downloadFromDrive = async (fileId) => {
    if (!accessToken) return null;
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        return await response.text();
    } catch (error) {
        console.error('다운로드 오류:', error);
        return null;
    }
};

// ========================================
// 파일 업데이트
// ========================================
const updateFile = async (fileId, content) => {
    if (!accessToken) return null;
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'text/plain'
                },
                body: content
            }
        );
        
        if (!response.ok) {
            throw new Error(`Update failed: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('파일 업데이트 오류:', error);
        return null;
    }
};

// ========================================
// 일정 데이터 저장
// ========================================
const saveSchedulesToDrive = async () => {
    try {
        const encrypted = encryptData(calendarData);
        const file = await findFile('schedules.cal');
        
        if (file) {
            await updateFile(file.id, encrypted);
            console.log('✅ 일정 업데이트 완료');
        } else {
            await uploadToDrive('schedules.cal', encrypted);
            console.log('✅ 일정 저장 완료');
        }
        
        updateStatus('저장 완료', 'connected');
        setTimeout(() => {
            updateStatus('연결됨', 'connected');
        }, 1500);
        
        return true;
    } catch (error) {
        console.error('❌ 저장 오류:', error);
        showToast('저장 실패', 'error');
        return false;
    }
};

// ========================================
// 일정 데이터 로드
// ========================================
const loadSchedulesFromDrive = async () => {
    try {
        const file = await findFile('schedules.cal');
        
        if (file) {
            const encryptedData = await downloadFromDrive(file.id);
            if (encryptedData) {
                calendarData = decryptData(encryptedData);
                console.log('✅ 일정 로드 완료:', calendarData.schedules.length, '개');
                return true;
            }
        }
        
        console.log('ℹ️ 저장된 일정 없음');
        return false;
    } catch (error) {
        console.error('❌ 로드 오류:', error);
        showToast('로드 실패', 'error');
        return false;
    }
};

// ========================================
// 자동 저장 스케줄
// ========================================
const scheduleAutoSave = () => {
    if (!accessToken || !isConnected) return;
    
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    
    // 저장 중 표시
    updateSyncStatus('saving', '저장 중...');
    
    autoSaveTimer = setTimeout(async () => {
        await saveSchedulesToDrive();
        console.log('🔄 자동 저장 완료');
        
        // 저장 완료 표시
        updateSyncStatus('saved', '저장 완료');
        
        // 3초 후 "연결됨"으로 변경
        setTimeout(() => {
            updateSyncStatus('saved', '연결됨');
        }, 3000);
    }, 3000);
};

// ========================================
// 동기화 상태 표시 업데이트
// ========================================
const updateSyncStatus = (status, text) => {
    const syncStatus = document.getElementById('syncStatus');
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');
    
    if (!syncStatus || !syncIcon || !syncText) return;
    
    // 모든 상태 클래스 제거
    syncStatus.classList.remove('saving', 'saved', 'loading', 'error');
    
    // 새 상태 적용
    switch (status) {
        case 'saving':
            syncStatus.classList.add('saving');
            syncIcon.textContent = '💾';
            break;
        case 'saved':
            syncStatus.classList.add('saved');
            syncIcon.textContent = '✅';
            break;
        case 'loading':
            syncStatus.classList.add('loading');
            syncIcon.textContent = '🔄';
            break;
        case 'error':
            syncStatus.classList.add('error');
            syncIcon.textContent = '❌';
            break;
    }
    
    syncText.textContent = text;
};


// ========================================
// Drive 연결 완료
// ========================================
const onDriveConnected = async () => {
    console.log('✅ Google Drive 연결 완료');
    
    isConnected = true;
    
    // UI 업데이트
    document.getElementById('connectBtn').style.display = 'none';
    const syncStatus = document.getElementById('syncStatus');
    if (syncStatus) {
        syncStatus.style.display = 'inline-flex';
        updateSyncStatus('loading', '불러오는 중...');
    }
    document.getElementById('syncGoogleCalendarBtn').style.display = 'inline-block';  // 다시 표시
    updateStatus('연결됨', 'connected');
    
    // 데이터 로드
    const loaded = await loadSchedulesFromDrive();
    
    if (loaded && calendarData.schedules.length > 0) {
        updateSyncStatus('saved', `${calendarData.schedules.length}개 로드됨`);
        showToast(`✅ ${calendarData.schedules.length}개 일정 로드 완료`);
        // 캘린더 렌더링 (calendar.js에서 처리)
        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
        // 3초 후 "연결됨"으로 변경
        setTimeout(() => {
            updateSyncStatus('saved', '연결됨');
        }, 3000);
    } else {
        updateSyncStatus('saved', '연결됨');
        showToast('✨ 일정관리를 시작하세요!');
    }
};

// ========================================
// 상태 업데이트
// ========================================
const updateStatus = (text, status = '') => {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.className = 'status-dot' + (status ? ` ${status}` : '');
    }
};

// ========================================
// 토스트 메시지
// ========================================
const showToast = (message, type = 'success') => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
};

// ========================================
// 일정 ID 생성
// ========================================
const generateId = () => {
    return 'SCH_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

// ========================================
// 일정 추가
// ========================================
const addSchedule = (scheduleData) => {
    const schedule = {
        id: generateId(),
        ...scheduleData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    calendarData.schedules.push(schedule);
    scheduleAutoSave();
    
    return schedule;
};

// ========================================
// 일정 수정
// ========================================
const updateSchedule = (scheduleId, updates) => {
    const index = calendarData.schedules.findIndex(s => s.id === scheduleId);
    if (index !== -1) {
        calendarData.schedules[index] = {
            ...calendarData.schedules[index],
            ...updates,
            updated_at: new Date().toISOString()
        };
        scheduleAutoSave();
        return true;
    }
    return false;
};

// ========================================
// 일정 삭제
// ========================================
const deleteSchedule = (scheduleId) => {
    const index = calendarData.schedules.findIndex(s => s.id === scheduleId);
    if (index !== -1) {
        calendarData.schedules.splice(index, 1);
        scheduleAutoSave();
        return true;
    }
    return false;
};

// ========================================
// 일정 검색
// ========================================
const searchSchedules = (query) => {
    if (!query) return calendarData.schedules;
    
    const lowerQuery = query.toLowerCase();
    return calendarData.schedules.filter(schedule => {
        return schedule.title.toLowerCase().includes(lowerQuery) ||
               (schedule.customer_name && schedule.customer_name.toLowerCase().includes(lowerQuery)) ||
               (schedule.description && schedule.description.toLowerCase().includes(lowerQuery)) ||
               (schedule.location && schedule.location.toLowerCase().includes(lowerQuery));
    });
};

// ========================================
// 색상 설정 업데이트
// ========================================
const updateColorSettings = (type, color) => {
    calendarData.colorSettings[type] = color;
    scheduleAutoSave();
};

// ========================================
// 사용자 설정 업데이트
// ========================================
const updateUserSettings = (settings) => {
    calendarData.userSettings = {
        ...calendarData.userSettings,
        ...settings
    };
    scheduleAutoSave();
};

// ========================================
// 초기화
// ========================================
const init = async () => {
    console.log('🚀 일정관리 시스템 초기화');
    
    // Google Drive 초기화
    await initGoogleDrive();
    
    // 로그인 상태 복원
    if (restoreLoginState()) {
        console.log('✅ 로그인 상태 복원');
        onDriveConnected();
    } else {
        updateStatus('연결 대기중');
    }
    
    // 연결 버튼
    document.getElementById('connectBtn')?.addEventListener('click', async () => {
        const granted = await requestDriveAccess();
        if (granted) {
            onDriveConnected();
        }
    });
    
    // 자동 저장만 사용 (수동 저장 버튼 제거됨)
    
    console.log('✅ 초기화 완료');
};

// ========================================
// 구글 캘린더 연동
// ========================================
let googleCalendarEnabled = false;
let googleCalendarEvents = [];
let googleCalendarSyncInterval = null;

// 구글 캘린더 API 로드
const loadGoogleCalendarAPI = async () => {
    return new Promise((resolve) => {
        if (window.gapi && window.gapi.client) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            gapi.load('client', resolve);
        };
        document.head.appendChild(script);
    });
};

// 구글 캘린더 초기화
const initGoogleCalendar = async () => {
    try {
        await loadGoogleCalendarAPI();
        
        await gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
        });
        
        // Access Token 설정
        gapi.client.setToken({ access_token: accessToken });
        
        console.log('✅ 구글 캘린더 API 초기화 완료');
        return true;
    } catch (error) {
        console.error('❌ 구글 캘린더 API 초기화 실패:', error);
        return false;
    }
};

// 구글 캘린더 일정 가져오기
const fetchGoogleCalendarEvents = async () => {
    if (!googleCalendarEnabled) return [];
    
    try {
        const now = new Date();
        const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const twoMonthsLater = new Date(now.getFullYear(), now.getMonth() + 3, 0);
        
        const response = await gapi.client.calendar.events.list({
            calendarId: 'primary',
            timeMin: oneMonthAgo.toISOString(),
            timeMax: twoMonthsLater.toISOString(),
            maxResults: 100,
            singleEvents: true,
            orderBy: 'startTime'
        });
        
        googleCalendarEvents = response.result.items || [];
        console.log(`✅ 구글 캘린더 일정 ${googleCalendarEvents.length}개 로드`);
        
        return googleCalendarEvents;
    } catch (error) {
        console.error('❌ 구글 캘린더 일정 로드 실패:', error);
        return [];
    }
};

// 구글 캘린더 동기화 시작
const startGoogleCalendarSync = async () => {
    const initialized = await initGoogleCalendar();
    if (!initialized) {
        console.warn('⚠️ 구글 캘린더 API 사용 불가 (권한 필요)');
        showToast('📗 구글 캘린더 권한이 없습니다. 일정 관리는 정상 작동합니다.', 'warning');
        return false;
    }
    
    googleCalendarEnabled = true;
    
    // 첫 동기화
    await fetchGoogleCalendarEvents();
    
    // 캘린더 렌더링 (calendar.js에서 처리)
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
    
    // 자동 동기화 (1시간마다)
    if (googleCalendarSyncInterval) {
        clearInterval(googleCalendarSyncInterval);
    }
    
    googleCalendarSyncInterval = setInterval(async () => {
        console.log('🔄 구글 캘린더 자동 동기화...');
        await fetchGoogleCalendarEvents();
        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
    }, 3600000); // 1시간
    
    showToast('✅ 구글 캘린더 동기화 시작');
    return true;
};

// 구글 캘린더 동기화 중지
const stopGoogleCalendarSync = () => {
    googleCalendarEnabled = false;
    googleCalendarEvents = [];
    
    if (googleCalendarSyncInterval) {
        clearInterval(googleCalendarSyncInterval);
        googleCalendarSyncInterval = null;
    }
    
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
    
    showToast('구글 캘린더 동기화 중지');
};

// 수동 새로고침
const refreshGoogleCalendar = async () => {
    if (!googleCalendarEnabled) {
        showToast('구글 캘린더가 연결되지 않았습니다', 'error');
        return;
    }
    
    showToast('🔄 동기화 중...');
    await fetchGoogleCalendarEvents();
    
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
    
    showToast('✅ 동기화 완료');
};

// ========================================
// 카카오톡 공유 기능
// ========================================

// 카카오 SDK 초기화
const initKakao = () => {
    if (typeof Kakao === 'undefined') {
        console.warn('⚠️ Kakao SDK가 로드되지 않았습니다');
        return false;
    }
    
    if (!Kakao.isInitialized()) {
        try {
            Kakao.init(KAKAO_APP_KEY);
            console.log('✅ Kakao SDK 초기화 완료');
            console.log('Kakao SDK 버전:', Kakao.VERSION);
            return true;
        } catch (error) {
            console.error('❌ Kakao SDK 초기화 실패:', error);
            return false;
        }
    }
    return true;
};

// 받침 판단 함수 (이/가 자동 선택)
const getSubjectParticle = (word) => {
    if (!word || word.length === 0) return '이';
    
    const lastChar = word.charAt(word.length - 1);
    const lastCharCode = lastChar.charCodeAt(0);
    
    // 한글이 아니면 '이' 반환
    if (lastCharCode < 0xAC00 || lastCharCode > 0xD7A3) {
        return '이';
    }
    
    // 한글의 받침 유무 판단
    // 한글 유니코드: 0xAC00(가) ~ 0xD7A3(힣)
    // (코드 - 0xAC00) % 28 == 0 이면 받침 없음
    const hasJongseong = (lastCharCode - 0xAC00) % 28 !== 0;
    
    return hasJongseong ? '이' : '가';
};

// 일정을 카카오톡으로 공유
const shareToKakao = (schedule) => {
    // 카카오 SDK 확인
    if (!initKakao()) {
        showToast('카카오톡 연동 오류', 'error');
        return;
    }
    
    // 플레이스홀더 키 체크
    if (KAKAO_APP_KEY === 'YOUR_JAVASCRIPT_KEY_HERE') {
        alert('⚠️ 카카오 개발자 설정이 필요합니다\n\nschedule-core.js 파일에서\nKAKAO_APP_KEY를 발급받은 키로 변경해주세요.');
        return;
    }
    
    try {
        // 일정 정보 포맷팅
        const scheduleDate = new Date(schedule.date);
        const dateStr = scheduleDate.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'short'
        });
        
        const timeStr = schedule.all_day 
            ? '종일' 
            : `${schedule.start_time} ~ ${schedule.end_time}`;
        
        const locationStr = schedule.location || '장소 미정';
        
        // 타입별 이모지
        const emojiMap = {
            '상령일': '🎂',
            '보험만기일': '⭐',
            '생일': '🎁',
            '결혼기념일': '💑',
            '미팅': '🤝',
            '상담': '📞',
            '기타': '📋'
        };
        const emoji = emojiMap[schedule.type] || '📅';
        
        // 메모 추가
        const memoStr = schedule.description ? `\n📝 ${schedule.description}` : '';
        
        // 사용자 정보 및 조사 처리
        const userName = calendarData.userInfo.name || '담당자';
        const userTitle = calendarData.userInfo.title || '';
        
        // 받침에 따라 '이/가' 자동 선택
        const particle = getSubjectParticle(userTitle || userName);
        const senderInfo = userTitle 
            ? `💼 ${userName} ${userTitle}${particle} 공유한 일정입니다.\n\n`
            : `💼 ${userName}${particle} 공유한 일정입니다.\n\n`;
        
        // 하단 메시지 (설정에서 가져오기)
        const bottomMessage = calendarData.userInfo.kakaoMessage || '';
        const bottomText = bottomMessage ? `\n\n※ ${bottomMessage}` : '';
        
        // URL 링크 처리
        const kakaoUrl = calendarData.userInfo.kakaoUrl || '';
        const kakaoUrlTitle = calendarData.userInfo.kakaoUrlTitle || '';
        
        let linkText = '';
        let linkObj = null;
        
        if (kakaoUrl) {
            if (kakaoUrlTitle) {
                // 제목이 있으면 제목만 표시
                linkText = `\n\n🔗 ${kakaoUrlTitle}`;
            } else {
                // 제목이 없으면 URL 그대로 표시
                linkText = `\n\n🔗 ${kakaoUrl}`;
            }
            
            // link 속성 추가 (클릭 가능하게)
            linkObj = {
                mobileWebUrl: kakaoUrl,
                webUrl: kakaoUrl
            };
        }
        
        // 카카오톡 메시지 전송
        const kakaoParams = {
            objectType: 'text',
            text: `${senderInfo}${emoji} ${schedule.title}\n\n📅 ${dateStr}\n🕐 ${timeStr}\n📍 ${locationStr}${memoStr}${bottomText}${linkText}`
        };
        
        // link가 있으면 추가
        if (linkObj) {
            kakaoParams.link = linkObj;
        }
        
        Kakao.Share.sendDefault(kakaoParams);
        
        console.log('✅ 카카오톡 공유 완료:', schedule.title);
        showToast('✅ 카카오톡으로 공유했습니다');
        
    } catch (error) {
        console.error('❌ 카카오톡 공유 오류:', error);
        showToast('카카오톡 공유 실패', 'error');
    }
}

// ========================================
// 할일 목록 관리
// ========================================
function addTodo(text, priority = 'normal') {
    if (!text || !text.trim()) return null;
    
    const todo = {
        id: Date.now().toString(),
        text: text.trim(),
        completed: false,
        priority: priority,  // high, normal, low
        createdAt: new Date().toISOString(),
        completedAt: null
    };
    
    calendarData.todos.push(todo);
    saveData();
    renderTodoList();
    updateTodoStats();
    
    return todo;
}

function toggleTodo(todoId) {
    const todo = calendarData.todos.find(t => t.id === todoId);
    if (todo) {
        todo.completed = !todo.completed;
        todo.completedAt = todo.completed ? new Date().toISOString() : null;
        saveData();
        renderTodoList();
        updateTodoStats();
    }
}

function deleteTodo(todoId) {
    calendarData.todos = calendarData.todos.filter(t => t.id !== todoId);
    saveData();
    renderTodoList();
    updateTodoStats();
}

function updateTodo(todoId, newText) {
    const todo = calendarData.todos.find(t => t.id === todoId);
    if (todo && newText && newText.trim()) {
        todo.text = newText.trim();
        saveData();
        renderTodoList();
    }
}

function clearCompletedTodos() {
    calendarData.todos = calendarData.todos.filter(t => !t.completed);
    saveData();
    renderTodoList();
    updateTodoStats();
}

// ========================================
// 디데이 (D-Day) 계산
// ========================================
function calculateDday(targetDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

function getDdayText(days) {
    if (days === 0) return 'D-Day';
    if (days > 0) return `D-${days}`;
    if (days < 0) return `D+${Math.abs(days)}`;
}

function getDdayColor(days) {
    if (days === 0) return '#ff0000'; // 오늘 - 빨강
    if (days <= 3) return '#ff6b6b'; // 3일 이내 - 주황
    if (days <= 7) return '#ffa500'; // 7일 이내 - 주황
    if (days <= 14) return '#ffd700'; // 14일 이내 - 노랑
    return '#4285f4'; // 그 이상 - 파랑
}

// ========================================
// ========================================
// 페이지 로드 시 초기화
// ========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
