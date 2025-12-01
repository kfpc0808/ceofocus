const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * 관리자가 사용자 비밀번호를 변경하는 Cloud Function
 * 호출: functions.httpsCallable('changeUserPassword')
 */
exports.changeUserPassword = functions.https.onCall(async (data, context) => {
    // 1. 관리자 인증 확인
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    
    // 관리자 권한 확인 (Firestore에서 확인)
    const callerUid = context.auth.uid;
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', '사용자 정보를 찾을 수 없습니다.');
    }
    
    const callerData = callerDoc.data();
    const isAdmin = callerData.isAdmin === true || 
                    callerData.role === 'admin' || 
                    callerData.type === 'admin';
    
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다.');
    }
    
    // 2. 파라미터 검증
    const { uid, newPassword } = data;
    
    if (!uid || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'uid와 newPassword가 필요합니다.');
    }
    
    if (newPassword.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.');
    }
    
    // 3. Firebase Auth 비밀번호 변경
    try {
        await admin.auth().updateUser(uid, {
            password: newPassword
        });
        
        // 4. Firestore도 업데이트
        await admin.firestore().collection('users').doc(uid).update({
            password: newPassword,
            isPasswordChanged: true,
            passwordChangedAt: admin.firestore.FieldValue.serverTimestamp(),
            passwordChangedBy: callerUid
        });
        
        return { success: true, message: '비밀번호가 변경되었습니다.' };
        
    } catch (error) {
        console.error('비밀번호 변경 오류:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * 관리자가 사용자를 삭제하는 Cloud Function
 */
exports.deleteUser = functions.https.onCall(async (data, context) => {
    // 관리자 인증 확인
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    
    const callerUid = context.auth.uid;
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', '사용자 정보를 찾을 수 없습니다.');
    }
    
    const callerData = callerDoc.data();
    const isAdmin = callerData.isAdmin === true || 
                    callerData.role === 'admin' || 
                    callerData.type === 'admin';
    
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다.');
    }
    
    const { uid } = data;
    
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'uid가 필요합니다.');
    }
    
    try {
        // Firebase Auth에서 삭제
        await admin.auth().deleteUser(uid);
        
        // Firestore에서 삭제
        await admin.firestore().collection('users').doc(uid).delete();
        await admin.firestore().collection('admins').doc(uid).delete().catch(() => {});
        
        return { success: true, message: '사용자가 삭제되었습니다.' };
        
    } catch (error) {
        console.error('사용자 삭제 오류:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
