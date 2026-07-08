import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword as fbSignIn,
  createUserWithEmailAndPassword as fbCreateUser,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged
} from "firebase/auth";
import { 
  getFirestore, 
  doc as fbDoc, 
  collection as fbCollection, 
  setDoc as fbSetDoc, 
  addDoc as fbAddDoc, 
  updateDoc as fbUpdateDoc, 
  deleteDoc as fbDeleteDoc, 
  getDoc as fbGetDoc, 
  getDocs as fbGetDocs, 
  onSnapshot as fbOnSnapshot 
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase SDK with direct platform configuration matching firebase-applet-config.json
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// AUTH ACTIONS RE-EXPORT
export const signInWithEmailAndPassword = fbSignIn;
export const createUserWithEmailAndPassword = fbCreateUser;
export const signOut = fbSignOut;
export const onAuthStateChanged = fbOnAuthStateChanged;

// CORE PATH REFERENCES RE-EXPORT
export const doc = fbDoc;
export const collection = fbCollection;

// ERROR LOGGING & HANDLING UTILITIES (FROM FIRESTORE INTEGRATION SKILL)
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errStr = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: errStr,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Recursively scrub 'undefined' values from firestore data payloads to prevent Firestore serialization errors
function sanitizeData(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeData);
  }
  if (typeof obj === 'object') {
    if (obj.constructor && obj.constructor.name !== 'Object' && obj.constructor.name !== 'Array') {
      return obj;
    }
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = sanitizeData(val);
      }
    }
    return cleaned;
  }
  return obj;
}

// WRAPPED FIRESTORE READ / WRITE METHODS FOR TRANSPARENT PERMISSION TRACKING
export async function setDoc(docRef: any, data: any, options?: any) {
  try {
    const cleanData = sanitizeData(data);
    return await fbSetDoc(docRef, cleanData, options);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docRef.path);
  }
}

export async function addDoc(collRef: any, data: any) {
  try {
    const cleanData = sanitizeData(data);
    return await fbAddDoc(collRef, cleanData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, collRef.path);
  }
}

export async function updateDoc(docRef: any, data: any) {
  try {
    const cleanData = sanitizeData(data);
    return await fbUpdateDoc(docRef, cleanData);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docRef.path);
  }
}

export async function deleteDoc(docRef: any) {
  try {
    return await fbDeleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docRef.path);
  }
}

export async function getDoc(docRef: any) {
  try {
    return await fbGetDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docRef.path);
  }
}

export async function getDocs(collRef: any) {
  try {
    return await fbGetDocs(collRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collRef.path);
  }
}

export function onSnapshot(
  targetRef: any, 
  onNext: (snapshot: any) => void, 
  onError?: (error: any) => void
) {
  return fbOnSnapshot(
    targetRef, 
    onNext, 
    (error) => {
      const errStr = error instanceof Error ? error.message : String(error);
      const errInfo: FirestoreErrorInfo = {
        error: errStr,
        authInfo: {
          userId: auth.currentUser?.uid || null,
          email: auth.currentUser?.email || null,
          emailVerified: auth.currentUser?.emailVerified || null,
          isAnonymous: auth.currentUser?.isAnonymous || null,
          tenantId: auth.currentUser?.tenantId || null,
          providerInfo: auth.currentUser?.providerData?.map(provider => ({
            providerId: provider.providerId,
            email: provider.email,
          })) || []
        },
        operationType: OperationType.GET,
        path: targetRef.path || null
      };

      console.error("Firestore Listener Error Detail (Graceful):", JSON.stringify(errInfo));

      if (onError) {
        try {
          onError(new Error(JSON.stringify(errInfo)));
        } catch (innerErr) {
          console.error("Secondary error inside local onError listener handoff:", innerErr);
        }
      }
    }
  );
}
