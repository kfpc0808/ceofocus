// Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyBdufefZCVqcYBQjppcbFGqVFpMhv1m0",
    authDomain: "kfpc-company-support-project.firebaseapp.com",
    projectId: "kfpc-company-support-project",
    storageBucket: "kfpc-company-support-project.firebasestorage.app",
    messagingSenderId: "1012609333373",
    appId: "1:1012609333373:web:343617679ca256005e6914"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);

// 내보내기
const auth = firebase.auth();
const db = firebase.firestore();