import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBFdMRkgofgpvreKvlBIUzY_W9EO6psz4Y',
  authDomain: 'veilmyr-crimson-register.firebaseapp.com',
  projectId: 'veilmyr-crimson-register',
  storageBucket: 'veilmyr-crimson-register.firebasestorage.app',
  messagingSenderId: '827426637064',
  appId: '1:827426637064:web:f0b38dc2a48d11fd0198bd',
};
export const db = getFirestore(initializeApp(firebaseConfig));
