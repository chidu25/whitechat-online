import { useState, useEffect } from 'react';
import { auth, googleProvider, db, rtdb } from './firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  orderBy,
  getDocs,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import { ref, set, onValue, off, onDisconnect } from 'firebase/database';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
  lastSeen: any;
}

interface Message {
  id: string;
  senderId: string;
  content: string;
  timestamp: any;
}

interface Conversation {
  id: string;
  members: string[];
  lastMessage?: string;
  lastMessageTime?: any;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [conversations, setConversations] = useState<Map<string, Conversation>>(new Map());
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Create/update user profile in Firestore
        const userRef = doc(db, 'profiles', currentUser.uid);
        await setDoc(userRef, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || 'Anonymous',
          photoURL: currentUser.photoURL || '',
          createdAt: serverTimestamp(),
          lastSeen: serverTimestamp()
        }, { merge: true });

        // Set online status in Realtime Database
        const statusRef = ref(rtdb, `status/${currentUser.uid}`);
        set(statusRef, {
          online: true,
          lastChanged: Date.now()
        });

        // Set offline on disconnect
        const statusRef = ref(rtdb, `status/${currentUser.uid}`);
        onDisconnect(statusRef).set({
          online: false,
          lastChanged: Date.now()
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Load all users
  useEffect(() => {
    if (!user) return;

    const usersRef = collection(db, 'profiles');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const usersList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserProfile;
        if (data.uid !== user.uid) {
          usersList.push(data);
        }
      });
      setUsers(usersList);
    });

    return () => unsubscribe();
  }, [user]);

  // Track online status
  useEffect(() => {
    if (!user) return;

    const statusRef = ref(rtdb, 'status');
    const unsubscribe = onValue(statusRef, (snapshot) => {
      const statuses = snapshot.val();
      const online = new Set<string>();
      if (statuses) {
        Object.keys(statuses).forEach((uid) => {
          if (statuses[uid].online) {
            online.add(uid);
          }
        });
      }
      setOnlineUsers(online);
    });

    return () => off(statusRef);
  }, [user]);

  // Load conversations for current user
  useEffect(() => {
    if (!user) return;

    const conversationsRef = collection(db, 'conversations');
    const q = query(conversationsRef, where('members', 'array-contains', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convMap = new Map<string, Conversation>();
      snapshot.forEach((doc) => {
        const data = doc.data();
        convMap.set(doc.id, {
          id: doc.id,
          members: data.members,
          lastMessage: data.lastMessage,
          lastMessageTime: data.lastMessageTime
        });
      });
      setConversations(convMap);
    });

    return () => unsubscribe();
  }, [user]);

  // Load messages for selected conversation
  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, `conversations/${currentConversationId}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messagesList: Message[] = [];
      snapshot.forEach((doc) => {
        messagesList.push({
          id: doc.id,
          ...doc.data()
        } as Message);
      });
      setMessages(messagesList);
    });

    return () => unsubscribe();
  }, [currentConversationId]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const firebaseError = error as FirebaseError;
      setAuthError(firebaseError.message);
      console.error('Sign-in error:', firebaseError);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (user) {
      const statusRef = ref(rtdb, `status/${user.uid}`);
      await set(statusRef, {
        online: false,
        lastChanged: Date.now()
      });
    }
    await signOut(auth);
    setSelectedUser(null);
    setCurrentConversationId(null);
    setMessages([]);
  };

  const handleUserSelect = async (selectedUserProfile: UserProfile) => {
    if (!user) return;

    setSelectedUser(selectedUserProfile);

    // Find existing conversation or create new one
    let conversationId: string | null = null;
    
    // Check if conversation exists
    conversations.forEach((conv, id) => {
      if (conv.members.includes(selectedUserProfile.uid) && conv.members.includes(user.uid)) {
        conversationId = id;
      }
    });

    if (!conversationId) {
      // Create new conversation
      const members = [user.uid, selectedUserProfile.uid].sort();
      conversationId = members.join('_');
      
      const convRef = doc(db, 'conversations', conversationId);
      await setDoc(convRef, {
        members: members,
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp()
      });
    }

    setCurrentConversationId(conversationId);
  };

  const handleSendMessage = async () => {
    if (!user || !currentConversationId || !newMessage.trim()) return;

    const messageRef = doc(collection(db, `conversations/${currentConversationId}/messages`));
    await setDoc(messageRef, {
      senderId: user.uid,
      content: newMessage.trim(),
      timestamp: serverTimestamp()
    });

    // Update conversation last message
    const convRef = doc(db, 'conversations', currentConversationId);
    await updateDoc(convRef, {
      lastMessage: newMessage.trim(),
      lastMessageTime: serverTimestamp()
    });

    setNewMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h1>WhiteChat Online</h1>
          <p>Simple, clean messaging for your inner circle</p>
          <button
            onClick={handleGoogleSignIn}
            disabled={isSigningIn}
            className="google-btn"
          >
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
          {authError && <p className="error">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="user-info">
          <img src={user.photoURL || ''} alt="Profile" className="profile-pic" />
          <div className="user-details">
            <div className="user-name">{user.displayName}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button onClick={handleSignOut} className="sign-out-btn">Sign Out</button>
        </div>
        
        <div className="users-list">
          <h3>People ({users.length})</h3>
          {users.map((userProfile) => (
            <div
              key={userProfile.uid}
              className={`user-item ${selectedUser?.uid === userProfile.uid ? 'selected' : ''}`}
              onClick={() => handleUserSelect(userProfile)}
            >
              <div className="user-avatar">
                <img src={userProfile.photoURL || ''} alt={userProfile.displayName} />
                <span className={`status-indicator ${onlineUsers.has(userProfile.uid) ? 'online' : 'offline'}`}></span>
              </div>
              <div className="user-info-text">
                <div className="user-name">{userProfile.displayName}</div>
                <div className="user-status">
                  {onlineUsers.has(userProfile.uid) ? 'Online' : 'Offline'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-area">
        {selectedUser ? (
          <>
            <div className="chat-header">
              <img src={selectedUser.photoURL || ''} alt={selectedUser.displayName} className="header-avatar" />
              <div className="header-info">
                <div className="header-name">{selectedUser.displayName}</div>
                <div className="header-status">
                  {onlineUsers.has(selectedUser.uid) ? 'Online' : 'Offline'}
                </div>
              </div>
            </div>

            <div className="messages-container">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`message ${message.senderId === user.uid ? 'sent' : 'received'}`}
                >
                  <div className="message-content">{message.content}</div>
                  <div className="message-time">{formatTimestamp(message.timestamp)}</div>
                </div>
              ))}
            </div>

            <div className="message-input-container">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="message-input"
              />
              <button onClick={handleSendMessage} className="send-btn">Send</button>
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <h2>WhiteChat Online</h2>
            <p>Select a person to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
