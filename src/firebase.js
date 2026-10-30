import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAjj-alZ2D5uHsJpJ_7RplezoIW21BRkag",
  authDomain: "inventario-negocio-ac986.firebaseapp.com",
  projectId: "inventario-negocio-ac986",
  storageBucket: "inventario-negocio-ac986.firebasestorage.app",
  messagingSenderId: "470780710248",
  appId: "1:470780710248:web:6c75009a06d0f4c71e1add"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);