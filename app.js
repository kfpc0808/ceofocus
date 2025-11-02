// ========================================
// SNS 올백업 시스템 v3.0 - 완전한 백업 시스템
// 증분 백업 + 날짜 선택 + 로컬 ZIP 다운로드 + 백업 이력
// ========================================

// ===== Google Drive 설정 (최신 GIS 방식) =====
const GOOGLE_CLIENT_ID = "288996084140-0eo93heqd66hqhg0fh1rbum6scnt3757.apps.googleusercontent.com";
const ENCRYPTION_KEY = "K7mP9nR4sT2vX8wY3zA6bC1dE5fG0hJ9";

// ===== API 설정 =====
const CONFIG = {
    INSTAGRAM_CLIENT_ID: 'YOUR_INSTAGRAM_CLIENT_ID',
    INSTAGRAM_CLIENT_SECRET: 'YOUR_INSTAGRAM_CLIENT_SECRET',
    INSTAGRAM_REDIRECT_URI: 'YOUR_REDIRECT_URI',
    YOUTUBE_CLIENT_ID: 'YOUR_YOUTUBE_CLIENT_ID',
    YOUTUBE_API_KEY: 'YOUR_YOUTUBE_API_KEY',
    GOOGLE_API_KEY: 'YOUR_GOOGLE_API_KEY',
    INSTAGRAM_API: 'https://graph.instagram.com',
    FACEBOOK_API: 'https://graph.facebook.com',
    YOUTUBE_API: 'https://www.googleapis.com/youtube/v3',
    DRIVE_API: 'https://www.googleapis.com/drive/v3'
};

// ===== 전역 변수 =====
let tokenClient = null;
let gisInited = false;
let driveAccessToken = null;
let autoSaveDebounceTimer = null;
let lastModifiedTime = null;

// ===== 전역 상태 =====
const state = {
    connections: {
        instagram: false,
        facebook: false,
        youtube: false,
        drive: false
    },
    tokens: {
        instagram: null,
        facebook: null,
        youtube: null,
        drive: null
    },
    backupData: {
        instagram: { count: 0, size: 0, items: [] },
        facebook: { count: 0, size: 0, items: [] },
        youtube: { count: 0, size: 0, items: [] }
    },
    backupProgress: {
        instagram: 0,
        facebook: 0,
        youtube: 0,
        isRunning: false
    },
    // 마지막 백업 시간 (증분 백업용)
    lastBackup: {
        instagram: null,
        facebook: null,
        youtube: null
    },
    // 백업 이력
    backupHistory: [],
    schedule: {
        instagram: {
            enabled: false,
            frequency: 'daily',
            time: '02:00',
            nextBackup: null
        },
        facebook: {
            enabled: false,
            frequency: 'daily',
            time: '02:00',
            nextBackup: null
        },
        youtube: {
            enabled: false,
            frequency: 'daily',
            time: '02:00',
            nextBackup: null
        }
    },
    settings: {
        notifications: {
            completion: true,
            error: true,
            storage: true
        },
        storage: {
            folderStructure: 'date',
            createThumbnails: true,
            compressVideos: false
        },
        encryption: {
            enabled: true
        }
    }
};

// ===== DOM 요소 =====
const elements = {
    tabs: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    driveConnectBtn: document.getElementById('drive-connect-btn'),
    driveStatusText: document.getElementById('drive-status-text'),
    instagramCount: document.getElementById('instagram-count'),
    instagramSize: document.getElementById('instagram-size'),
    facebookCount: document.getElementById('facebook-count'),
    facebookSize: document.getElementById('facebook-size'),
    youtubeCount: document.getElementById('youtube-count'),
    youtubeSize: document.getElementById('youtube-size'),
    totalSize: document.getElementById('total-size'),
    startBackupBtn: document.getElementById('start-backup-btn'),
    stopBackupBtn: document.getElementById('stop-backup-btn'),
    backupProgress: document.getElementById('backup-progress'),
    currentStatus: document.getElementById('current-status'),
    estimatedTime: document.getElementById('estimated-time'),
    // 백업 모드 관련
    backupModeIncremental: document.getElementById('backup-mode-incremental'),
    backupModeFull: document.getElementById('backup-mode-full'),
    backupModeDate: document.getElementById('backup-mode-date'),
    dateRangeOptions: document.getElementById('date-range-options'),
    backupStartDate: document.getElementById('backup-start-date'),
    backupEndDate: document.getElementById('backup-end-date'),
    lastBackupText: document.getElementById('last-backup-text'),
    // 저장 위치
    saveToDrive: document.getElementById('save-to-drive'),
    saveToLocal: document.getElementById('save-to-local'),
    // 이력
    historyTableBody: document.getElementById('history-table-body')
};

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 SNS 백업 시스템 초기화 시작...');
    
    try {
        console.log('1. 탭 초기화...');
        initTabs();
        
        console.log('2. 연결 버튼 초기화...');
        initConnectionButtons();
        
        console.log('3. 상태 불러오기...');
        loadState();
        
        console.log('4. 대시보드 초기화...');
        initDashboard();
        
        console.log('5. Google Identity Services 초기화...');
        initGoogleIdentityServices();
        
        console.log('6. 백업 모드 초기화...');
        initBackupMode();
        
        console.log('7. 마지막 백업 정보 업데이트...');
        updateLastBackupInfo();
        
        console.log('8. 백업 이력 업데이트...');
        updateBackupHistory();
        
        console.log('9. 예약 초기화...');
        initSchedule();
        
        console.log('10. 이벤트 리스너 등록...');
        
        // 이벤트 리스너
        if (elements.driveConnectBtn) {
            elements.driveConnectBtn.addEventListener('click', connectDrive);
            console.log('✓ Drive 연결 버튼 등록');
        }
        
        if (elements.startBackupBtn) {
            elements.startBackupBtn.addEventListener('click', startBackup);
            console.log('✓ 백업 시작 버튼 등록');
        }
        
        if (elements.stopBackupBtn) {
            elements.stopBackupBtn.addEventListener('click', stopBackup);
            console.log('✓ 백업 중지 버튼 등록');
        }
        
        // 예약 저장 버튼들
        ['instagram', 'facebook', 'youtube'].forEach(platform => {
            const btn = document.getElementById(`save-schedule-${platform}-btn`);
            if (btn) {
                btn.addEventListener('click', () => savePlatformSchedule(platform));
                console.log(`✓ ${platform} 예약 버튼 등록`);
            }
        });
        
        // 백업 목록 불러오기
        const listBtn = document.getElementById('list-backups-btn');
        if (listBtn) {
            listBtn.addEventListener('click', listBackupsFromDrive);
            console.log('✓ 백업 목록 버튼 등록');
        }
        
        // 설정 탭 버튼들
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', saveSettings);
            console.log('✓ 설정 저장 버튼 등록');
        }
        
        const openDriveBtn = document.getElementById('open-drive-btn');
        if (openDriveBtn) {
            openDriveBtn.addEventListener('click', () => {
                window.open('https://drive.google.com/drive/my-drive', '_blank');
            });
            console.log('✓ Drive 열기 버튼 등록');
        }
        
        const testSaveBtn = document.getElementById('test-save-btn');
        if (testSaveBtn) {
            testSaveBtn.addEventListener('click', async () => {
                if (!driveAccessToken) {
                    showNotification('먼저 Google Drive에 연결하세요!', 'warning');
                    return;
                }
                await saveBackupToDrive(state.backupData, new Date().toISOString());
                showNotification('테스트 저장 완료!', 'success');
            });
            console.log('✓ 테스트 저장 버튼 등록');
        }
        
        const testLoadBtn = document.getElementById('test-load-btn');
        if (testLoadBtn) {
            testLoadBtn.addEventListener('click', async () => {
                if (!driveAccessToken) {
                    showNotification('먼저 Google Drive에 연결하세요!', 'warning');
                    return;
                }
                showNotification('설정 탭에서 백업 목록을 불러오세요!', 'info');
            });
            console.log('✓ 테스트 불러오기 버튼 등록');
        }
        
        console.log('✅ SNS 백업 시스템 초기화 완료!');
        
    } catch (error) {
        console.error('❌ 초기화 중 오류 발생:', error);
        alert('초기화 중 오류가 발생했습니다. 콘솔을 확인하세요: ' + error.message);
    }
});

// ===== 탭 전환 =====
function initTabs() {
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    const activeContent = document.getElementById(tabName);
    
    activeTab?.classList.add('active');
    activeContent?.classList.add('active');
}

// ===== 연결 버튼 초기화 =====
function initConnectionButtons() {
    console.log('🔗 연결 버튼 초기화 시작...');
    const buttons = document.querySelectorAll('.btn-connect');
    console.log(`찾은 연결 버튼 개수: ${buttons.length}`);
    
    buttons.forEach((btn, index) => {
        const platform = btn.dataset.platform;
        console.log(`버튼 ${index + 1}: ${platform}`);
        
        btn.addEventListener('click', () => {
            console.log(`🖱️ ${platform} 버튼 클릭됨!`);
            if (platform === 'drive') {
                connectDrive();
            } else {
                connectPlatform(platform);
            }
        });
    });
    
    console.log('✓ 연결 버튼 초기화 완료');
}

// ===== 플랫폼 연결 (시뮬레이션) =====
function connectPlatform(platform) {
    console.log(`📱 ${platform} 연결 시도...`);
    showNotification(`${platform} 연결 기능은 실제 API 설정 후 사용 가능합니다.`, 'info');
    
    // 시뮬레이션: 연결 상태로 변경
    state.connections[platform] = true;
    updateConnectionStatus(platform, true);
    saveState();
    console.log(`✓ ${platform} 연결 완료 (시뮬레이션)`);
}

function updateConnectionStatus(platform, connected) {
    const statusElement = document.querySelector(`#${platform}-status .status-badge`);
    const btnElement = document.querySelector(`[data-platform="${platform}"]`);
    
    if (statusElement) {
        statusElement.textContent = connected ? '연결됨' : '미연결';
        statusElement.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
    }
    
    if (btnElement && platform !== 'drive') {
        btnElement.textContent = connected ? '✓ 연결됨' : '연결';
        btnElement.disabled = connected;
    }
}

// ===== 백업 모드 초기화 =====
function initBackupMode() {
    // 백업 모드 변경 이벤트
    elements.backupModeIncremental?.addEventListener('change', updateBackupModeUI);
    elements.backupModeFull?.addEventListener('change', updateBackupModeUI);
    elements.backupModeDate?.addEventListener('change', updateBackupModeUI);
    
    // 오늘 날짜를 기본값으로
    const today = new Date().toISOString().split('T')[0];
    if (elements.backupEndDate) elements.backupEndDate.value = today;
    
    updateBackupModeUI();
}

function updateBackupModeUI() {
    const dateMode = elements.backupModeDate?.checked;
    if (elements.dateRangeOptions) {
        elements.dateRangeOptions.style.display = dateMode ? 'block' : 'none';
    }
}

// ===== 마지막 백업 정보 표시 =====
function updateLastBackupInfo() {
    const lastBackups = [];
    
    if (state.lastBackup.instagram) {
        lastBackups.push(`Instagram: ${formatDate(state.lastBackup.instagram)}`);
    }
    if (state.lastBackup.facebook) {
        lastBackups.push(`Facebook: ${formatDate(state.lastBackup.facebook)}`);
    }
    if (state.lastBackup.youtube) {
        lastBackups.push(`YouTube: ${formatDate(state.lastBackup.youtube)}`);
    }
    
    if (elements.lastBackupText) {
        if (lastBackups.length > 0) {
            elements.lastBackupText.textContent = lastBackups.join(' | ');
        } else {
            elements.lastBackupText.textContent = '마지막 백업: 없음';
        }
    }
}

// ===== 날짜 포맷팅 =====
function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// ===== 상태 저장/불러오기 =====
function saveState() {
    localStorage.setItem('sns-backup-state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('sns-backup-state');
    if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(state, parsed);
    }
    
    // Drive 토큰 자동 복원
    const savedToken = localStorage.getItem('drive_access_token');
    const tokenExpiry = localStorage.getItem('drive_token_expiry');
    
    if (savedToken && tokenExpiry) {
        const now = Date.now();
        if (now < parseInt(tokenExpiry)) {
            driveAccessToken = savedToken;
            state.connections.drive = true;
            state.tokens.drive = savedToken;
            updateDriveStatus(true);
        }
    }
}

// ===== 대시보드 초기화 =====
function initDashboard() {
    updateDashboard();
}

function updateDashboard() {
    // 백업 현황 업데이트
    if (elements.instagramCount) elements.instagramCount.textContent = state.backupData.instagram.count;
    if (elements.instagramSize) elements.instagramSize.textContent = formatSize(state.backupData.instagram.size);
    if (elements.facebookCount) elements.facebookCount.textContent = state.backupData.facebook.count;
    if (elements.facebookSize) elements.facebookSize.textContent = formatSize(state.backupData.facebook.size);
    if (elements.youtubeCount) elements.youtubeCount.textContent = state.backupData.youtube.count;
    if (elements.youtubeSize) elements.youtubeSize.textContent = formatSize(state.backupData.youtube.size);
    
    const totalSize = state.backupData.instagram.size + state.backupData.facebook.size + state.backupData.youtube.size;
    if (elements.totalSize) elements.totalSize.textContent = formatSize(totalSize);
    
    // 통계 업데이트
    updateStats();
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// ===== Google Identity Services 초기화 =====
function initGoogleIdentityServices() {
    if (typeof google === 'undefined' || !google.accounts) {
        console.error('Google Identity Services not loaded');
        return;
    }
    
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                driveAccessToken = tokenResponse.access_token;
                state.connections.drive = true;
                state.tokens.drive = tokenResponse.access_token;
                
                // 토큰 저장 (1시간 유효)
                const expiry = Date.now() + 3600000;
                localStorage.setItem('drive_access_token', tokenResponse.access_token);
                localStorage.setItem('drive_token_expiry', expiry.toString());
                
                updateDriveStatus(true);
                saveState();
                showNotification('Google Drive에 연결되었습니다!', 'success');
            }
        },
        error_callback: (error) => {
            console.error('OAuth error:', error);
            showNotification('Google Drive 연결에 실패했습니다.', 'error');
        }
    });
    
    gisInited = true;
}

// ===== Google Drive 연결 =====
function connectDrive() {
    if (!gisInited) {
        showNotification('Google Identity Services가 초기화되지 않았습니다.', 'error');
        return;
    }
    
    if (!driveAccessToken) {
        tokenClient.requestAccessToken();
    } else {
        showNotification('이미 Google Drive에 연결되어 있습니다.', 'success');
    }
}

function updateDriveStatus(connected) {
    if (elements.driveStatusText) {
        elements.driveStatusText.textContent = connected ? '연결됨' : '연결 안 됨';
        elements.driveStatusText.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
    }
    if (elements.driveConnectBtn) {
        elements.driveConnectBtn.textContent = connected ? '✓ 연결됨' : '연결';
        elements.driveConnectBtn.disabled = connected;
    }
}

// ===== 암호화/복호화 =====
function encryptData(data) {
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, ENCRYPTION_KEY).toString();
    return encrypted;
}

function decryptData(encryptedData) {
    try {
        const decrypted = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
        const jsonString = decrypted.toString(CryptoJS.enc.Utf8);
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

// ===== Google Drive API 함수들 =====
async function findFile(filename) {
    if (!driveAccessToken) {
        console.error('No Drive access token');
        return null;
    }
    
    try {
        const response = await fetch(
            `${CONFIG.DRIVE_API}/files?q=name='${filename}' and trashed=false&fields=files(id,name,modifiedTime)`,
            {
                headers: {
                    'Authorization': `Bearer ${driveAccessToken}`
                }
            }
        );
        
        if (!response.ok) throw new Error('Failed to search file');
        
        const data = await response.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    } catch (error) {
        console.error('Find file error:', error);
        return null;
    }
}

async function uploadToDrive(filename, content, contentType = 'application/json') {
    if (!driveAccessToken) {
        throw new Error('Drive not connected');
    }
    
    const metadata = {
        name: filename,
        mimeType: contentType
    };
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: contentType }));
    
    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${driveAccessToken}`
            },
            body: form
        }
    );
    
    if (!response.ok) throw new Error('Upload failed');
    return await response.json();
}

async function updateFile(fileId, content, contentType = 'application/json') {
    if (!driveAccessToken) {
        throw new Error('Drive not connected');
    }
    
    const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${driveAccessToken}`,
                'Content-Type': contentType
            },
            body: content
        }
    );
    
    if (!response.ok) throw new Error('Update failed');
    return await response.json();
}

async function downloadFromDrive(fileId) {
    if (!driveAccessToken) {
        throw new Error('Drive not connected');
    }
    
    const response = await fetch(
        `${CONFIG.DRIVE_API}/files/${fileId}?alt=media`,
        {
            headers: {
                'Authorization': `Bearer ${driveAccessToken}`
            }
        }
    );
    
    if (!response.ok) throw new Error('Download failed');
    return await response.text();
}

// ===== 백업 실행 =====
async function startBackup() {
    // Drive 연결 확인
    if (!driveAccessToken && elements.saveToDrive?.checked) {
        showNotification('먼저 Google Drive에 연결하세요!', 'warning');
        switchTab('dashboard');
        return;
    }
    
    // 플랫폼 선택 확인
    const selectedPlatforms = [];
    if (document.getElementById('backup-instagram')?.checked) selectedPlatforms.push('instagram');
    if (document.getElementById('backup-facebook')?.checked) selectedPlatforms.push('facebook');
    if (document.getElementById('backup-youtube')?.checked) selectedPlatforms.push('youtube');
    
    if (selectedPlatforms.length === 0) {
        showNotification('최소 하나의 플랫폼을 선택하세요!', 'warning');
        return;
    }
    
    // 저장 위치 확인
    const saveToDrive = elements.saveToDrive?.checked;
    const saveToLocal = elements.saveToLocal?.checked;
    
    if (!saveToDrive && !saveToLocal) {
        showNotification('최소 하나의 저장 위치를 선택하세요!', 'warning');
        return;
    }
    
    // 백업 모드 확인
    const backupMode = getBackupMode();
    let dateFilter = null;
    
    if (backupMode === 'date-range') {
        const startDate = elements.backupStartDate?.value;
        const endDate = elements.backupEndDate?.value;
        
        if (!startDate || !endDate) {
            showNotification('시작 날짜와 종료 날짜를 선택하세요!', 'warning');
            return;
        }
        
        dateFilter = { startDate, endDate };
    }
    
    // 백업 시작
    state.backupProgress.isRunning = true;
    elements.startBackupBtn.style.display = 'none';
    elements.stopBackupBtn.style.display = 'block';
    elements.backupProgress.style.display = 'block';
    
    try {
        const results = {};
        const backupStartTime = new Date().toISOString();
        
        for (const platform of selectedPlatforms) {
            if (!state.backupProgress.isRunning) break;
            
            elements.currentStatus.textContent = `${platform} 백업 중...`;
            
            let items = [];
            
            // 백업 모드에 따라 데이터 가져오기
            if (backupMode === 'full') {
                // 전체 백업
                items = await fetchPlatformData(platform, null);
            } else if (backupMode === 'incremental') {
                // 증분 백업 - 마지막 백업 이후만
                const since = state.lastBackup[platform];
                items = await fetchPlatformData(platform, since);
            } else if (backupMode === 'date-range' && dateFilter) {
                // 날짜 선택 백업
                items = await fetchPlatformData(platform, null, dateFilter);
            }
            
            results[platform] = {
                count: items.length,
                size: calculateSize(items),
                items: items
            };
            
            // 진행 상황 업데이트
            updateProgress(platform, 100);
            
            // 마지막 백업 시간 업데이트 (증분 백업용)
            state.lastBackup[platform] = backupStartTime;
        }
        
        // 저장
        if (saveToDrive) {
            await saveBackupToDrive(results, backupStartTime);
        }
        
        if (saveToLocal) {
            await downloadBackupAsZip(results, backupStartTime);
        }
        
        // 백업 이력 추가
        addBackupHistory(selectedPlatforms, results, backupStartTime, backupMode);
        
        // 상태 업데이트
        for (const platform of selectedPlatforms) {
            if (backupMode === 'full') {
                state.backupData[platform] = results[platform];
            } else {
                // 증분 백업의 경우 기존 데이터에 추가
                state.backupData[platform].items.push(...results[platform].items);
                state.backupData[platform].count += results[platform].count;
                state.backupData[platform].size += results[platform].size;
            }
        }
        
        saveState();
        updateDashboard();
        updateLastBackupInfo();
        updateBackupHistory();
        
        showNotification('백업이 완료되었습니다!', 'success');
        
    } catch (error) {
        console.error('Backup error:', error);
        showNotification(`백업 실패: ${error.message}`, 'error');
    } finally {
        state.backupProgress.isRunning = false;
        elements.startBackupBtn.style.display = 'block';
        elements.stopBackupBtn.style.display = 'none';
        elements.currentStatus.textContent = '완료';
    }
}

function stopBackup() {
    state.backupProgress.isRunning = false;
    showNotification('백업이 중지되었습니다.', 'warning');
}

function getBackupMode() {
    if (elements.backupModeIncremental?.checked) return 'incremental';
    if (elements.backupModeFull?.checked) return 'full';
    if (elements.backupModeDate?.checked) return 'date-range';
    return 'full';
}

// ===== 플랫폼 데이터 가져오기 (시뮬레이션) =====
async function fetchPlatformData(platform, since = null, dateFilter = null) {
    // 실제로는 각 플랫폼 API를 호출해야 합니다
    // 여기서는 시뮬레이션만 수행합니다
    
    elements.currentStatus.textContent = `${platform} 데이터 가져오는 중...`;
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // 시뮬레이션
    
    // 시뮬레이션 데이터 생성
    const items = [];
    const itemCount = Math.floor(Math.random() * 20) + 10; // 10-30개
    
    for (let i = 0; i < itemCount; i++) {
        const itemDate = new Date();
        itemDate.setDate(itemDate.getDate() - Math.floor(Math.random() * 30));
        const itemTimestamp = itemDate.toISOString();
        
        // 날짜 필터 적용
        if (dateFilter) {
            const itemDateStr = itemDate.toISOString().split('T')[0];
            if (itemDateStr < dateFilter.startDate || itemDateStr > dateFilter.endDate) {
                continue;
            }
        }
        
        // 증분 백업 필터 적용
        if (since && itemTimestamp < since) {
            continue;
        }
        
        items.push({
            id: `${platform}_${Date.now()}_${i}`,
            platform: platform,
            timestamp: itemTimestamp,
            type: 'post',
            content: `Sample content ${i}`,
            media_url: null,
            size: Math.floor(Math.random() * 1000000) // Random size
        });
    }
    
    return items;
}

function calculateSize(items) {
    return items.reduce((total, item) => total + (item.size || 0), 0);
}

function updateProgress(platform, percent) {
    const progressFill = document.getElementById(`${platform}-progress`);
    const progressText = document.getElementById(`${platform}-progress-text`);
    
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `${percent}%`;
    
    state.backupProgress[platform] = percent;
}

// ===== Drive에 백업 저장 =====
async function saveBackupToDrive(results, timestamp) {
    elements.currentStatus.textContent = 'Google Drive에 저장 중...';
    
    const backupData = {
        timestamp: timestamp,
        results: results
    };
    
    const encrypted = encryptData(backupData);
    const filename = `sns-backup-${timestamp}.dat`;
    
    const existingFile = await findFile(filename);
    
    if (existingFile) {
        await updateFile(existingFile.id, encrypted, 'application/octet-stream');
    } else {
        await uploadToDrive(filename, encrypted, 'application/octet-stream');
    }
    
    showNotification('Drive에 저장 완료!', 'success');
}

// ===== 로컬 ZIP 다운로드 =====
async function downloadBackupAsZip(results, timestamp) {
    elements.currentStatus.textContent = 'ZIP 파일 생성 중...';
    
    const zip = new JSZip();
    
    // 각 플랫폼별 폴더 생성
    for (const [platform, data] of Object.entries(results)) {
        const folder = zip.folder(platform);
        
        // 메타데이터 저장
        folder.file('metadata.json', JSON.stringify({
            timestamp: timestamp,
            count: data.count,
            size: data.size,
            items: data.items
        }, null, 2));
        
        // 실제 환경에서는 미디어 파일도 다운로드해서 포함
        // 여기서는 시뮬레이션만
        data.items.forEach((item, index) => {
            folder.file(`item_${index}.json`, JSON.stringify(item, null, 2));
        });
    }
    
    // README 추가
    zip.file('README.txt', `SNS 백업 파일
백업 시간: ${timestamp}
플랫폼: ${Object.keys(results).join(', ')}

이 백업은 SNS 올백업 시스템에서 생성되었습니다.
`);
    
    // ZIP 생성 및 다운로드
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sns-backup-${timestamp.split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('ZIP 파일 다운로드 완료!', 'success');
}

// ===== 백업 이력 추가 =====
function addBackupHistory(platforms, results, timestamp, mode) {
    const totalCount = Object.values(results).reduce((sum, r) => sum + r.count, 0);
    const totalSize = Object.values(results).reduce((sum, r) => sum + r.size, 0);
    
    const history = {
        timestamp: timestamp,
        platforms: platforms,
        mode: mode,
        count: totalCount,
        size: totalSize,
        status: '완료'
    };
    
    state.backupHistory.unshift(history); // 최신순 정렬
    
    // 최대 50개만 유지
    if (state.backupHistory.length > 50) {
        state.backupHistory = state.backupHistory.slice(0, 50);
    }
    
    saveState();
}

// ===== 백업 이력 표시 =====
function updateBackupHistory() {
    if (!elements.historyTableBody) return;
    
    if (state.backupHistory.length === 0) {
        elements.historyTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">백업 이력이 없습니다.</td></tr>';
        return;
    }
    
    const rows = state.backupHistory.map(history => {
        const modeText = {
            'full': '전체',
            'incremental': '증분',
            'date-range': '날짜 선택'
        }[history.mode] || '전체';
        
        return `
            <tr>
                <td>${formatDate(history.timestamp)}</td>
                <td>${history.platforms.map(p => {
                    const icons = { instagram: '📷', facebook: '📘', youtube: '🎬' };
                    return icons[p] || p;
                }).join(' ')}</td>
                <td>${history.count}개 (${modeText})</td>
                <td>${formatSize(history.size)}</td>
                <td><span class="status-badge connected">${history.status}</span></td>
            </tr>
        `;
    }).join('');
    
    elements.historyTableBody.innerHTML = rows;
}

// ===== 통계 업데이트 =====
function updateStats() {
    const totalCount = state.backupData.instagram.count + state.backupData.facebook.count + state.backupData.youtube.count;
    
    if (totalCount === 0) return;
    
    const instagramPercent = Math.round((state.backupData.instagram.count / totalCount) * 100);
    const facebookPercent = Math.round((state.backupData.facebook.count / totalCount) * 100);
    const youtubePercent = Math.round((state.backupData.youtube.count / totalCount) * 100);
    
    document.getElementById('instagram-percent').textContent = `${instagramPercent}%`;
    document.getElementById('facebook-percent').textContent = `${facebookPercent}%`;
    document.getElementById('youtube-percent').textContent = `${youtubePercent}%`;
    
    document.getElementById('instagram-bar').style.width = `${instagramPercent}%`;
    document.getElementById('facebook-bar').style.width = `${facebookPercent}%`;
    document.getElementById('youtube-bar').style.width = `${youtubePercent}%`;
    
    document.getElementById('instagram-info').textContent = 
        `${state.backupData.instagram.count}개 (${formatSize(state.backupData.instagram.size)})`;
    document.getElementById('facebook-info').textContent = 
        `${state.backupData.facebook.count}개 (${formatSize(state.backupData.facebook.size)})`;
    document.getElementById('youtube-info').textContent = 
        `${state.backupData.youtube.count}개 (${formatSize(state.backupData.youtube.size)})`;
}

// ===== 예약 설정 =====
function initSchedule() {
    ['instagram', 'facebook', 'youtube'].forEach(platform => {
        const enableCheckbox = document.getElementById(`enable-schedule-${platform}`);
        const configDiv = document.getElementById(`schedule-config-${platform}`);
        
        enableCheckbox?.addEventListener('change', (e) => {
            configDiv.style.display = e.target.checked ? 'block' : 'none';
        });
        
        // 기존 설정 복원
        if (state.schedule[platform].enabled) {
            enableCheckbox.checked = true;
            configDiv.style.display = 'block';
            
            const frequency = state.schedule[platform].frequency;
            const time = state.schedule[platform].time;
            
            document.querySelector(`input[name="schedule-frequency-${platform}"][value="${frequency}"]`).checked = true;
            document.getElementById(`schedule-time-${platform}`).value = time;
            
            updateNextBackupTime(platform);
        }
    });
    
    updateScheduleStatus();
}

function savePlatformSchedule(platform) {
    const enabled = document.getElementById(`enable-schedule-${platform}`).checked;
    
    if (!enabled) {
        state.schedule[platform].enabled = false;
        saveState();
        updateScheduleStatus();
        showNotification(`${platform} 예약이 비활성화되었습니다.`, 'success');
        return;
    }
    
    const frequency = document.querySelector(`input[name="schedule-frequency-${platform}"]:checked`).value;
    const time = document.getElementById(`schedule-time-${platform}`).value;
    
    state.schedule[platform] = {
        enabled: true,
        frequency: frequency,
        time: time,
        nextBackup: calculateNextBackupTime(frequency, time)
    };
    
    saveState();
    updateNextBackupTime(platform);
    updateScheduleStatus();
    
    showNotification(`${platform} 예약이 저장되었습니다!`, 'success');
}

function calculateNextBackupTime(frequency, time) {
    const now = new Date();
    const [hours, minutes] = time.split(':');
    const next = new Date();
    next.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    if (frequency === 'daily') {
        if (next <= now) next.setDate(next.getDate() + 1);
    } else if (frequency === 'weekly') {
        if (next <= now) next.setDate(next.getDate() + 7);
        else next.setDate(next.getDate() + (7 - next.getDay()));
    } else if (frequency === 'monthly') {
        if (next <= now) next.setMonth(next.getMonth() + 1);
        next.setDate(1);
    }
    
    return next.toISOString();
}

function updateNextBackupTime(platform) {
    const nextTimeElement = document.getElementById(`next-backup-time-${platform}`);
    if (nextTimeElement && state.schedule[platform].nextBackup) {
        nextTimeElement.textContent = new Date(state.schedule[platform].nextBackup).toLocaleString('ko-KR');
    }
}

function updateScheduleStatus() {
    const statusList = document.getElementById('schedule-status-list');
    if (!statusList) return;
    
    const activeSchedules = Object.entries(state.schedule).filter(([_, config]) => config.enabled);
    
    if (activeSchedules.length === 0) {
        statusList.innerHTML = '<p class="empty-state">설정된 예약 백업이 없습니다.</p>';
        return;
    }
    
    const icons = { instagram: '📷', facebook: '📘', youtube: '🎬' };
    const names = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' };
    
    const html = activeSchedules.map(([platform, config]) => {
        const frequencyText = { daily: '매일', weekly: '매주', monthly: '매월' }[config.frequency];
        const nextBackup = config.nextBackup ? new Date(config.nextBackup).toLocaleString('ko-KR') : '계산 중...';
        
        return `
            <div class="schedule-status-item ${platform}">
                <div class="schedule-status-info">
                    <div class="schedule-status-platform">${icons[platform]} ${names[platform]}</div>
                    <div class="schedule-status-details">
                        ${frequencyText} ${config.time} | 다음 백업: ${nextBackup}
                    </div>
                </div>
                <div class="schedule-status-actions">
                    <button class="btn-schedule-delete" onclick="deletePlatformSchedule('${platform}')">삭제</button>
                </div>
            </div>
        `;
    }).join('');
    
    statusList.innerHTML = html;
}

function deletePlatformSchedule(platform) {
    if (!confirm(`${platform} 예약 백업을 삭제하시겠습니까?`)) return;
    
    state.schedule[platform].enabled = false;
    state.schedule[platform].nextBackup = null;
    
    const enableCheckbox = document.getElementById(`enable-schedule-${platform}`);
    const configDiv = document.getElementById(`schedule-config-${platform}`);
    
    if (enableCheckbox) enableCheckbox.checked = false;
    if (configDiv) configDiv.style.display = 'none';
    
    saveState();
    updateScheduleStatus();
    
    showNotification(`${platform} 예약이 삭제되었습니다.`, 'success');
}

// deletePlatformSchedule를 전역으로 노출
window.deletePlatformSchedule = deletePlatformSchedule;

// ===== 알림 표시 =====
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
}

// ===== Drive 백업 목록 불러오기 =====
async function listBackupsFromDrive() {
    if (!driveAccessToken) {
        showNotification('먼저 Google Drive에 연결하세요!', 'warning');
        switchTab('dashboard');
        return;
    }
    
    try {
        showNotification('백업 목록을 불러오는 중...', 'info');
        
        // Drive에서 sns-backup으로 시작하는 파일 검색
        const response = await fetch(
            `${CONFIG.DRIVE_API}/files?q=name contains 'sns-backup' and trashed=false&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime desc`,
            {
                headers: {
                    'Authorization': `Bearer ${driveAccessToken}`
                }
            }
        );
        
        if (!response.ok) throw new Error('백업 목록 조회 실패');
        
        const data = await response.json();
        
        if (!data.files || data.files.length === 0) {
            showBackupListUI([]);
            showNotification('저장된 백업이 없습니다.', 'warning');
            return;
        }
        
        showBackupListUI(data.files);
        showNotification(`${data.files.length}개의 백업을 찾았습니다!`, 'success');
        
    } catch (error) {
        console.error('백업 목록 조회 오류:', error);
        showNotification(`오류: ${error.message}`, 'error');
    }
}

// ===== 백업 목록 UI 표시 =====
function showBackupListUI(files) {
    const container = document.getElementById('backup-list-container');
    const listElement = document.getElementById('backup-list');
    
    if (!container || !listElement) return;
    
    container.style.display = 'block';
    
    if (files.length === 0) {
        listElement.innerHTML = '<div class="backup-list-empty">저장된 백업이 없습니다.</div>';
        return;
    }
    
    const html = files.map(file => {
        // 파일명에서 날짜 추출 (sns-backup-2024-11-01T14:30:00.000Z.dat)
        const dateMatch = file.name.match(/sns-backup-(.+?)\.dat/);
        const dateStr = dateMatch ? dateMatch[1] : file.modifiedTime;
        const formattedDate = formatDate(dateStr);
        
        // 파일 크기 포맷팅
        const sizeInBytes = parseInt(file.size) || 0;
        const formattedSize = formatSize(sizeInBytes);
        
        return `
            <div class="backup-list-item">
                <div class="backup-list-header">
                    <span class="backup-list-date">📦 ${formattedDate}</span>
                    <span class="backup-list-size">${formattedSize}</span>
                </div>
                <div class="backup-list-details">
                    <span>파일명: ${file.name}</span>
                </div>
                <div class="backup-list-actions">
                    <button class="btn-secondary" onclick="loadBackupFromDriveById('${file.id}')">
                        👁️ 화면에 표시
                    </button>
                    <button class="btn-secondary" onclick="downloadBackupAsZipFromDrive('${file.id}', '${file.name}')">
                        💾 ZIP 다운로드
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    listElement.innerHTML = html;
}

// ===== Drive에서 백업 불러와서 화면에 표시 =====
async function loadBackupFromDriveById(fileId) {
    if (!driveAccessToken) {
        showNotification('Drive 연결이 필요합니다!', 'warning');
        return;
    }
    
    try {
        showNotification('백업을 불러오는 중...', 'info');
        
        const content = await downloadFromDrive(fileId);
        
        // 복호화
        const decrypted = decryptData(content);
        
        if (!decrypted) {
            throw new Error('백업 파일 복호화 실패');
        }
        
        // 상태 업데이트
        if (decrypted.results) {
            // v3 형식 (증분 백업 지원)
            for (const [platform, data] of Object.entries(decrypted.results)) {
                if (state.backupData[platform]) {
                    state.backupData[platform] = data;
                }
            }
        } else {
            // 이전 형식
            state.backupData = decrypted;
        }
        
        saveState();
        updateDashboard();
        
        showNotification('백업 불러오기 완료! 대시보드에서 확인하세요.', 'success');
        switchTab('dashboard');
        
    } catch (error) {
        console.error('백업 불러오기 오류:', error);
        showNotification(`오류: ${error.message}`, 'error');
    }
}

// ===== Drive에서 백업 불러와서 ZIP으로 다운로드 =====
async function downloadBackupAsZipFromDrive(fileId, filename) {
    if (!driveAccessToken) {
        showNotification('Drive 연결이 필요합니다!', 'warning');
        return;
    }
    
    try {
        showNotification('백업을 다운로드하는 중...', 'info');
        
        const content = await downloadFromDrive(fileId);
        
        // 복호화
        const decrypted = decryptData(content);
        
        if (!decrypted) {
            throw new Error('백업 파일 복호화 실패');
        }
        
        // ZIP 파일 생성
        const zip = new JSZip();
        
        let results = decrypted.results || decrypted;
        const timestamp = decrypted.timestamp || new Date().toISOString();
        
        // 각 플랫폼별 폴더 생성
        for (const [platform, data] of Object.entries(results)) {
            if (platform === 'timestamp') continue;
            
            const folder = zip.folder(platform);
            
            // 메타데이터 저장
            folder.file('metadata.json', JSON.stringify({
                timestamp: timestamp,
                count: data.count || 0,
                size: data.size || 0,
                items: data.items || []
            }, null, 2));
            
            // 각 항목 저장
            if (data.items && Array.isArray(data.items)) {
                data.items.forEach((item, index) => {
                    folder.file(`item_${index}.json`, JSON.stringify(item, null, 2));
                });
            }
        }
        
        // README 추가
        zip.file('README.txt', `SNS 백업 파일
백업 시간: ${timestamp}
원본 파일: ${filename}

이 백업은 SNS 올백업 시스템에서 Google Drive로부터 다운로드되었습니다.
각 플랫폼 폴더에는 백업된 데이터가 JSON 형식으로 저장되어 있습니다.
`);
        
        // ZIP 생성 및 다운로드
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        
        // 파일명에서 날짜 추출
        const dateMatch = filename.match(/sns-backup-(.+?)\.dat/);
        const dateStr = dateMatch ? dateMatch[1].split('T')[0] : new Date().toISOString().split('T')[0];
        
        a.download = `sns-backup-${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('ZIP 파일 다운로드 완료!', 'success');
        
    } catch (error) {
        console.error('ZIP 다운로드 오류:', error);
        showNotification(`오류: ${error.message}`, 'error');
    }
}

// 전역으로 노출
window.loadBackupFromDriveById = loadBackupFromDriveById;
window.downloadBackupAsZipFromDrive = downloadBackupAsZipFromDrive;

// ===== 설정 저장 =====
function saveSettings() {
    // 알림 설정
    state.settings.notifications.completion = document.getElementById('notify-completion')?.checked || false;
    state.settings.notifications.error = document.getElementById('notify-error')?.checked || false;
    state.settings.notifications.storage = document.getElementById('notify-storage')?.checked || false;
    
    // 저장 옵션
    state.settings.storage.folderStructure = document.getElementById('folder-structure')?.value || 'date';
    state.settings.storage.createThumbnails = document.getElementById('create-thumbnails')?.checked || false;
    state.settings.storage.compressVideos = document.getElementById('compress-videos')?.checked || false;
    
    saveState();
    showNotification('설정이 저장되었습니다!', 'success');
}
