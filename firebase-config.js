const firebaseConfig = {
  apiKey: "AIzaSyDburefZCVqCY8QQppcdQFoqVFpMriv1m0",
  authDomain: "kfpc-company-support-project.firebaseapp.com",
  databaseURL: "https://kfpc-company-support-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kfpc-company-support-project",
  storageBucket: "kfpc-company-support-project.firebasestorage.app",
  messagingSenderId: "101260933373",
  appId: "1:101260933373:web:3436176f9ca256005​6d914",
  measurementId: "G-TRQCDPL8B4"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);

// 내보내기
const auth = firebase.auth();
const db = firebase.firestore();