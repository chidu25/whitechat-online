import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { auth, db, googleProvider } from './firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

const systemPrompt = `You are WhiteChat, an empathetic UPSC mentor.
Provide thorough, structured guidance for civil services preparation.
Remember each learner's previous questions and answers to keep continuity.
Summaries, revision strategies, syllabus references, and balanced motivation are encouraged.
Tailor every reply to the user's unique needs while staying accurate to UPSC requirements.`;

const generateTitle = (text: string) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'New UPSC conversation';
  }
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
};

const formatTime = (date?: Date) => {
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

type Conversation = {
  id: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [draftMessage, setDraftMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
      setConversationsLoading(false);
      setMessagesLoading(false);
      return;
    }

    setConversationsLoading(true);
    const conversationsRef = collection(db, 'users', user.uid, 'conversations');
    const conversationsQuery = query(conversationsRef, orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(
      conversationsQuery,
      (snapshot) => {
        const nextConversations: Conversation[] = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as {
            title?: string;
            createdAt?: Timestamp;
            updatedAt?: Timestamp;
          };
          return {
            id: docSnapshot.id,
            title: data.title || 'New UPSC conversation',
            createdAt: data.createdAt ? data.createdAt.toDate() : undefined,
            updatedAt: data.updatedAt ? data.updatedAt.toDate() : undefined,
          };
        });
        setConversations(nextConversations);
        setConversationsLoading(false);
      },
      (error) => {
        console.error('Error loading conversations:', error);
        setConversations([]);
        setConversationsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!conversations.length) {
      setActiveConversationId(null);
      return;
    }
    if (!activeConversationId || !conversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(conversations[0]?.id ?? null);
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    if (!user || !activeConversationId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    setMessages([]);
    setMessagesLoading(true);
    const messagesRef = collection(db, 'users', user.uid, 'conversations', activeConversationId, 'messages');
    const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const nextMessages: ChatMessage[] = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as {
            role: 'user' | 'assistant';
            content: string;
            createdAt?: Timestamp;
          };
          return {
            id: docSnapshot.id,
            role: data.role,
            content: data.content,
            createdAt: data.createdAt ? data.createdAt.toDate() : undefined,
          };
        });
        setMessages(nextMessages);
        setMessagesLoading(false);
      },
      (error) => {
        console.error('Error loading messages:', error);
        setMessages([]);
        setMessagesLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user, activeConversationId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);

    try {
      await setDoc(doc(db, 'mentorConversations', conversationId), {
        ownerId: user.uid,
        title: newConversation.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (error instanceof FirebaseError) {
        if (error.code === 'auth/popup-blocked') {
          try {
            await signInWithRedirect(auth, googleProvider);
            return;
          } catch (redirectError) {
            console.error('Redirect sign-in failed:', redirectError);
            setAuthError('Please allow popups for this site or try again later.');
          }
        } else if (error.code !== 'auth/cancelled-popup-request') {
          setAuthError(error.message);
        }
      } else {
        setAuthError('Something went wrong while trying to sign you in. Please try again.');
      }
      console.error('Error signing in:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleNewConversation = async () => {
    if (!user) {
      return;
    }

    try {
      const conversationRef = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
        title: 'New UPSC conversation',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveConversationId(conversationRef.id);
      setDraftMessage('');
      setChatError(null);
    } catch (error) {
      console.error('Error creating new conversation:', error);
    }
  };

  const handleSendMessage = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!user || !draftMessage.trim() || isSending) {
      return;
    }

    setIsSending(true);
    setChatError(null);

    const text = draftMessage.trim();
    setDraftMessage('');

    try {
      let conversationId = activeConversationId;

      if (!conversationId) {
        const newConversationRef = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
          title: 'New UPSC conversation',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        conversationId = newConversationRef.id;
        setActiveConversationId(newConversationRef.id);
      }

      const conversationRef = doc(db, 'users', user.uid, 'conversations', conversationId!);
      const messagesRef = collection(conversationRef, 'messages');

      await addDoc(messagesRef, {
        role: 'user',
        content: text,
        createdAt: serverTimestamp(),
      });

      const previousMessages =
        conversationId === activeConversationId ? messages : [];
      const hasExistingUserMessage = previousMessages.some((message) => message.role === 'user');

      const conversationUpdates: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };

      if (!hasExistingUserMessage) {
        conversationUpdates.title = generateTitle(text);
      }

      await setDoc(conversationRef, conversationUpdates, { merge: true });

      const history = [
        ...previousMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: text },
      ].filter((message) => message.role === 'user' || message.role === 'assistant');

      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('Missing OpenRouter API key. Please set OPENROUTER_API_KEY or VITE_OPENROUTER_API_KEY.');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'WhiteChat',
        },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      const assistantMessage: string =
        result?.choices?.[0]?.message?.content?.trim() ||
        'I’m ready with more UPSC guidance whenever you need it.';

      await addDoc(messagesRef, {
        role: 'assistant',
        content: assistantMessage,
        createdAt: serverTimestamp(),
      });

      await setDoc(conversationRef, { updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error('Error sending message:', error);
      setChatError(
        error instanceof Error
          ? error.message
          : 'Something went wrong while contacting the mentor model. Please try again.',
      );
    } finally {
      setIsSending(false);
    }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  if (initializing) {
    return (
      <div className="loading-screen">
        <div className="spinner" aria-hidden />
        <p>Preparing WhiteChat…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <header>
            <h1>WhiteChat</h1>
            <p className="auth-subtitle">Your personalised UPSC mentor, now powered by memory.</p>
          </header>
          <button
            className="auth-button"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? 'Signing you in…' : 'Continue with Google'}
          </button>
          {authError && <p className="auth-error">{authError}</p>}
          <footer className="auth-footer">
            <p>We securely remember your sessions so guidance always builds on past conversations.</p>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="sidebar-kicker">WhiteChat</p>
            <h2 className="sidebar-title">UPSC Companion</h2>
          </div>
          <button className="new-chat-button" type="button" onClick={handleNewConversation}>
            New chat
          </button>
        </div>
        <div className="sidebar-scroll" role="navigation" aria-label="Previous conversations">
          {conversationsLoading ? (
            <p className="sidebar-empty">Loading conversations…</p>
          ) : conversations.length ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`conversation-item${
                  conversation.id === activeConversationId ? ' conversation-item--active' : ''
                }`}
                onClick={() => {
                  setActiveConversationId(conversation.id);
                  setChatError(null);
                }}
              >
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-meta">
                  {conversation.updatedAt ? `Updated ${formatTime(conversation.updatedAt)}` : 'Just now'}
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">Start your first UPSC session.</p>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="user-card">
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" referrerPolicy="no-referrer" />
            ) : (
              <span className="user-avatar" aria-hidden>
                {(user.displayName || user.email || 'U')[0]?.toUpperCase()}
              </span>
            )}
            <div>
              <p className="user-name">{user.displayName || user.email}</p>
              <button type="button" className="signout-button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div>
            <h1>{activeConversation ? activeConversation.title : 'WhiteChat mentor'}</h1>
            <p>Guidance tailored to your UPSC journey. Ask follow-ups anytime.</p>
          </div>
        </header>

        <section className="message-list" aria-live="polite">
          {messagesLoading ? (
            <div className="message-placeholder">Loading your conversation…</div>
          ) : messages.length ? (
            messages.map((message) => (
              <article
                key={message.id}
                className={`message message--${message.role}`}
              >
                <p>{message.content}</p>
                <span className="message-time">{formatTime(message.createdAt)}</span>
              </article>
            ))
          ) : (
            <div className="message-placeholder">
              <h2>Welcome back!</h2>
              <p>
                Share your target exam cycle, current preparation stage, or the topics you’re exploring.
                WhiteChat will build on every session to guide you strategically.
              </p>
            </div>
          )}
          {isSending && (
            <article className="message message--assistant message--thinking">
              <p>WhiteChat is reflecting on your strategy…</p>
            </article>
          )}
          <div ref={messageEndRef} />
        </section>

        <footer className="composer">
          <form onSubmit={handleSendMessage}>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask WhiteChat about strategy, resources, or daily planning…"
              rows={1}
              disabled={isSending}
            />
            <div className="composer-actions">
              {chatError && <p className="chat-error">{chatError}</p>}
              <button type="submit" className="send-button" disabled={isSending || !draftMessage.trim()}>
                {isSending ? 'Thinking…' : 'Send'}
              </button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  );
}

export default App;
