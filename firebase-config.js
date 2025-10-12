// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyDbufefZCVqCY8QQppcdQFoqVFpMriv1m0",
  authDomain: "kfpc-company-support-project.firebaseapp.com",
  databaseURL: "https://kfpc-company-support-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kfpc-company-support-project",
  storageBucket: "kfpc-company-support-project.firebasestorage.app",
  messagingSenderId: "1012609333373",
  appId: "1:1012609333373:web:3436176f9ca2560056d914",
  measurementId: "G-TRQCDPL8B4"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();