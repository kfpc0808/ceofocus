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
        '미팅': '#FFFFFF',  // 흰색 배경 (보험업계 미팅 중심 사용 패턴 고려)
        '상담': '#6BCF7F',
        '기타': '#FFFFFF'   // 흰색 배경으로 변경
    },
    // 타입별 글자색 설정 (배경색과 대비를 위해)
    textColorSettings: {
        '상령일': '#FFFFFF',      // 빨간 배경 → 흰 글자
        '보험만기일': '#FFFFFF',   // 주황 배경 → 흰 글자
        '생일': '#FFFFFF',        // 보라 배경 → 흰 글자
        '결혼기념일': '#333333',  // 분홍 배경 → 검정 글자
        '미팅': '#333333',        // 흰 배경 → 검정 글자
        '상담': '#FFFFFF',        // 초록 배경 → 흰 글자
        '기타': '#333333'         // 흰 배경 → 검정 글자
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
        kakaoMessage: '자세한 내용은 연락주시기 바랍니다.',  // 카카오톡 공유 하단 메시지
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
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        
        if (response.status === 401) {
            console.log('❌ 토큰 만료');
            accessToken = null;
            localStorage.removeItem('googleAccessToken');
            localStorage.removeItem('tokenExpiry');
            return null;
        }
        
        const data = await response.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    } catch (error) {
        console.error('파일 검색 오류:', error);
        return null;
    }
};

// ========================================
// 파일 읽기
// ========================================
const readFile = async (fileId) => {
    if (!accessToken) return null;
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        
        if (!response.ok) {
            console.error('❌ 파일 읽기 실패:', response.status);
            return null;
        }
        
        const encryptedData = await response.text();
        return decryptData(encryptedData);
    } catch (error) {
        console.error('파일 읽기 오류:', error);
        return null;
    }
};

// ========================================
// 파일 생성
// ========================================
const createFile = async (filename, content) => {
    if (!accessToken) return null;
    
    const metadata = {
        name: filename,
        mimeType: 'text/plain'
    };
    
    const encryptedContent = encryptData(content);
    
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', new Blob([encryptedContent], { type: 'text/plain' }));
    
    try {
        const response = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}` },
                body: formData
            }
        );
        
        if (!response.ok) {
            console.error('❌ 파일 생성 실패:', response.status);
            return null;
        }
        
        return await response.json();
    } catch (error) {
        console.error('파일 생성 오류:', error);
        return null;
    }
};

// ========================================
// 파일 업데이트
// ========================================
const updateFile = async (fileId, content) => {
    if (!accessToken) return false;
    
    const encryptedContent = encryptData(content);
    
    try {
        const response = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'text/plain'
                },
                body: encryptedContent
            }
        );
        
        if (!response.ok) {
            console.error('❌ 파일 업데이트 실패:', response.status);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('파일 업데이트 오류:', error);
        return false;
    }
};

// ========================================
// 데이터 저장
// ========================================
const saveToGoogleDrive = async () => {
    if (!accessToken) return;
    
    updateStatus('저장 중...', 'saving');
    
    const filename = 'kfpc_schedule_data.enc';
    const file = await findFile(filename);
    
    let saved = false;
    if (file) {
        saved = await updateFile(file.id, calendarData);
    } else {
        const newFile = await createFile(filename, calendarData);
        saved = !!newFile;
    }
    
    if (saved) {
        updateStatus('저장 완료', 'saved');
        console.log('✅ Google Drive에 저장 완료');
        setTimeout(() => updateStatus('연결됨', ''), 1000);
    } else {
        updateStatus('저장 실패', 'error');
        showToast('❌ 저장 실패', 'error');
    }
};

// ========================================
// 데이터 로드
// ========================================
const loadFromGoogleDrive = async () => {
    if (!accessToken) return;
    
    updateStatus('불러오는 중...', 'loading');
    
    const filename = 'kfpc_schedule_data.enc';
    const file = await findFile(filename);
    
    if (file) {
        const data = await readFile(file.id);
        if (data) {
            calendarData = data;
            
            // textColorSettings가 없는 경우 초기화
            if (!calendarData.textColorSettings) {
                calendarData.textColorSettings = {
                    '상령일': '#FFFFFF',
                    '보험만기일': '#FFFFFF',
                    '생일': '#FFFFFF',
                    '결혼기념일': '#333333',
                    '미팅': '#333333',
                    '상담': '#FFFFFF',
                    '기타': '#333333'
                };
            }
            
            console.log('✅ Google Drive에서 불러오기 완료');
            updateStatus('불러오기 완료', 'saved');
            return true;
        }
    }
    
    updateStatus('데이터 없음', '');
    return false;
};

// ========================================
// 로컬 스토리지 백업
// ========================================
const saveToLocalStorage = () => {
    try {
        localStorage.setItem('kfpc_calendar_data', JSON.stringify(calendarData));
        console.log('💾 로컬 스토리지 백업 완료');
    } catch (error) {
        console.error('로컬 스토리지 저장 실패:', error);
    }
};

const loadFromLocalStorage = () => {
    try {
        const data = localStorage.getItem('kfpc_calendar_data');
        if (data) {
            calendarData = JSON.parse(data);
            
            // textColorSettings가 없는 경우 초기화
            if (!calendarData.textColorSettings) {
                calendarData.textColorSettings = {
                    '상령일': '#FFFFFF',
                    '보험만기일': '#FFFFFF',
                    '생일': '#FFFFFF',
                    '결혼기념일': '#333333',
                    '미팅': '#333333',
                    '상담': '#FFFFFF',
                    '기타': '#333333'
                };
            }
            
            console.log('💾 로컬 스토리지에서 불러오기 완료');
            return true;
        }
    } catch (error) {
        console.error('로컬 스토리지 로드 실패:', error);
    }
    return false;
};

// ========================================
// 자동 저장
// ========================================
const scheduleAutoSave = () => {
    // 이전 타이머 취소
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    
    // 3초 후 저장
    autoSaveTimer = setTimeout(() => {
        saveToLocalStorage(); // 로컬 스토리지에 즉시 백업
        
        if (accessToken) {
            saveToGoogleDrive(); // 구글 드라이브에도 저장
        }
    }, 3000);
};

// ========================================
// 동기화 상태 업데이트
// ========================================
const updateSyncStatus = (status, text) => {
    const syncStatus = document.getElementById('syncStatus');
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');
    const connectBtn = document.getElementById('connectBtn');
    
    if (status === 'connected' || status === 'saved') {
        syncStatus.style.display = 'inline-flex';
        connectBtn.style.display = 'none';
        syncIcon.textContent = '✅';
        syncText.textContent = text || '연결됨';
    } else {
        syncStatus.style.display = 'none';
        connectBtn.style.display = 'inline-block';
    }
};

// ========================================
// 연결 완료 후 처리
// ========================================
const onDriveConnected = async () => {
    isConnected = true;
    updateSyncStatus('connected', '연결됨');
    
    // 구글 캘린더 버튼 표시
    document.getElementById('syncGoogleCalendarBtn').style.display = 'inline-block';
    document.getElementById('refreshGoogleCalendarBtn').style.display = 'inline-block';
    
    // 데이터 로드
    const loaded = await loadFromGoogleDrive();
    
    if (loaded) {
        // 데이터가 있으면 캘린더 다시 렌더링
        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
        
        // 할일 목록 렌더링
        if (typeof renderTodoList === 'function') {
            renderTodoList();
        }
        
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
    
    // 글자색 자동 계산 (밝기에 따라)
    const rgb = parseInt(color.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    if (!calendarData.textColorSettings) {
        calendarData.textColorSettings = {};
    }
    calendarData.textColorSettings[type] = brightness > 128 ? '#333333' : '#FFFFFF';
    
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
        gapi.load('client', async () => {
            await gapi.client.init({
                apiKey: GOOGLE_API_KEY,
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
            });
            resolve();
        });
    });
};

// 구글 캘린더 이벤트 가져오기
const fetchGoogleCalendarEvents = async () => {
    if (!accessToken) {
        console.error('❌ 구글 캘린더 접근 토큰이 없습니다');
        return [];
    }
    
    try {
        // 현재 시간 기준 앞뒤 3개월
        const timeMin = new Date();
        timeMin.setMonth(timeMin.getMonth() - 1);
        const timeMax = new Date();
        timeMax.setMonth(timeMax.getMonth() + 3);
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
            `timeMin=${timeMin.toISOString()}&` +
            `timeMax=${timeMax.toISOString()}&` +
            `singleEvents=true&` +
            `orderBy=startTime&` +
            `maxResults=100`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        if (!response.ok) {
            console.error('❌ 구글 캘린더 API 호출 실패:', response.status);
            return [];
        }
        
        const data = await response.json();
        console.log(`📗 구글 캘린더에서 ${data.items.length}개 이벤트 가져옴`);
        return data.items || [];
    } catch (error) {
        console.error('구글 캘린더 이벤트 가져오기 오류:', error);
        return [];
    }
};

// 구글 캘린더 동기화 토글
const toggleGoogleCalendarSync = async () => {
    const btn = document.getElementById('syncGoogleCalendarBtn');
    
    if (!googleCalendarEnabled) {
        // 활성화
        googleCalendarEvents = await fetchGoogleCalendarEvents();
        googleCalendarEnabled = true;
        btn.classList.add('active');
        btn.title = '구글 캘린더 동기화 중';
        
        // 30초마다 자동 새로고침
        googleCalendarSyncInterval = setInterval(async () => {
            if (googleCalendarEnabled) {
                googleCalendarEvents = await fetchGoogleCalendarEvents();
                if (typeof renderCalendar === 'function') {
                    renderCalendar();
                }
            }
        }, 30000);
        
        showToast('📗 구글 캘린더 동기화 시작', 'success');
    } else {
        // 비활성화
        googleCalendarEnabled = false;
        googleCalendarEvents = [];
        btn.classList.remove('active');
        btn.title = '구글 캘린더 동기화';
        
        if (googleCalendarSyncInterval) {
            clearInterval(googleCalendarSyncInterval);
            googleCalendarSyncInterval = null;
        }
        
        showToast('📗 구글 캘린더 동기화 중지', 'info');
    }
    
    // 캘린더 다시 렌더링
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
};

// 구글 캘린더 새로고침
const refreshGoogleCalendar = async () => {
    if (!googleCalendarEnabled) return;
    
    const btn = document.getElementById('refreshGoogleCalendarBtn');
    btn.classList.add('rotating');
    
    googleCalendarEvents = await fetchGoogleCalendarEvents();
    
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
    
    setTimeout(() => {
        btn.classList.remove('rotating');
    }, 500);
    
    showToast('📗 구글 캘린더 새로고침 완료', 'success');
};

// ========================================
// 할일 관리
// ========================================
const addTodo = (text) => {
    const todo = {
        id: 'TODO_' + Date.now(),
        text: text,
        completed: false,
        created_at: new Date().toISOString()
    };
    
    calendarData.todos.push(todo);
    scheduleAutoSave();
    return todo;
};

const toggleTodo = (todoId) => {
    const todo = calendarData.todos.find(t => t.id === todoId);
    if (todo) {
        todo.completed = !todo.completed;
        scheduleAutoSave();
        return true;
    }
    return false;
};

const deleteTodo = (todoId) => {
    const index = calendarData.todos.findIndex(t => t.id === todoId);
    if (index !== -1) {
        calendarData.todos.splice(index, 1);
        scheduleAutoSave();
        return true;
    }
    return false;
};

// ========================================
// 카카오 SDK 초기화
// ========================================
if (typeof Kakao !== 'undefined') {
    try {
        if (!Kakao.isInitialized()) {
            Kakao.init(KAKAO_APP_KEY);
            console.log('✅ Kakao SDK 초기화 완료');
        }
    } catch (error) {
        console.warn('Kakao SDK 초기화 실패:', error);
    }
}

// 사용자 정보 업데이트
const updateUserInfo = (info) => {
    calendarData.userInfo = {
        ...calendarData.userInfo,
        ...info
    };
    scheduleAutoSave();
};

// 받침 판별 함수
function getSubjectParticle(word) {
    if (!word || word.length === 0) return '이';
    
    const lastChar = word.charCodeAt(word.length - 1);
    // 한글 범위 체크 (가 = 44032, 힣 = 55203)
    if (lastChar < 44032 || lastChar > 55203) return '이';
    
    // 받침 유무 판별 ((lastChar - 44032) % 28)
    return ((lastChar - 44032) % 28) === 0 ? '가' : '이';
}

// DOMContentLoaded 이벤트
document.addEventListener('DOMContentLoaded', init);
