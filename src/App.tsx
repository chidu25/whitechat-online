import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { auth, googleProvider } from './firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

type ChatMessage = {
  id: string;
  author: 'self' | 'companion';
  content: string;
  timestamp: string;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: '1',
      author: 'companion',
      content: 'Morning! Ready to review the latest screen flows?',
      timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    },
    {
      id: '2',
      author: 'self',
      content: 'Absolutely — let’s walk through them together.',
      timestamp: new Date(Date.now() - 1000 * 60 * 33).toISOString(),
    },
    {
      id: '3',
      author: 'companion',
      content: 'Great. I’ll start with the onboarding tweaks we discussed.',
      timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    },
  ]);
  const [isCompanionTyping, setIsCompanionTyping] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const pendingReply = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);

    try {
      await signInWithPopup(auth, googleProvider);
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

  useEffect(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isCompanionTyping]);

  useEffect(() => {
    return () => {
      if (pendingReply.current) {
        window.clearTimeout(pendingReply.current);
      }
    };
  }, []);

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftMessage.trim()) {
      return;
    }

    const now = new Date();
    const text = draftMessage.trim();

    setMessages((prev) => [
      ...prev,
      {
        id: `${now.getTime()}-self`,
        author: 'self',
        content: text,
        timestamp: now.toISOString(),
      },
    ]);
    setDraftMessage('');

    if (pendingReply.current) {
      window.clearTimeout(pendingReply.current);
    }

    setIsCompanionTyping(true);
    pendingReply.current = window.setTimeout(() => {
      const replyAt = new Date();
      setMessages((prev) => [
        ...prev,
        {
          id: `${replyAt.getTime()}-companion`,
          author: 'companion',
          content: 'Perfect. I’ll capture notes and send a follow-up recap once we wrap.',
          timestamp: replyAt.toISOString(),
        },
      ]);
      setIsCompanionTyping(false);
      pendingReply.current = null;
    }, 1800);
  };

  const formatTime = (isoString: string) => {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(isoString));
  };

  const companionProfile = useMemo(
    () => ({
      name: 'Aurora Lane',
      role: 'Product Designer',
      avatar:
        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=facearea&facepad=2&w=160&h=160&q=80',
    }),
    []
  );

  const signedInAvatar =
    user?.photoURL ??
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=facearea&facepad=3&w=160&h=160&q=80';

  if (!user) {
    return (
      <div className="auth-screen">
        <header>
          <h1>WhiteChat Online</h1>
          <p className="auth-tagline">A lightweight, mobile-ready collaboration space.</p>
        </header>
        <button
          onClick={handleGoogleSignIn}
          className="auth-button"
          disabled={isSigningIn}
        >
          {isSigningIn ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {authError ? <p className="auth-error">{authError}</p> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="user-chip">
          <img src={signedInAvatar} alt={user.displayName ?? 'Signed in user'} />
          <div>
            <span className="user-chip__label">Signed in</span>
            <span className="user-chip__name">{user.displayName ?? 'WhiteChat Pro'}</span>
          </div>
        </div>
        <button className="signout" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <main className="chat-shell">
        <div className="chat-header">
          <div className="chat-partner">
            <img src={companionProfile.avatar} alt={`${companionProfile.name}'s avatar`} />
            <div>
              <h2>{companionProfile.name}</h2>
              <p>{companionProfile.role}</p>
            </div>
          </div>
          <span className="chat-status">Active now</span>
        </div>

        <div className="chat-body" role="log" aria-live="polite">
          <ol className="message-list">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`message message--${message.author}`}
              >
                <span className="message-time">{formatTime(message.timestamp)}</span>
                <p>{message.content}</p>
              </li>
            ))}
            {isCompanionTyping ? (
              <li className="message message--companion" role="status">
                <span className="message-time">Now</span>
                <div className="typing-dots" aria-label="Typing">
                  <span />
                  <span />
                  <span />
                </div>
              </li>
            ) : null}
            <div ref={scrollAnchorRef} />
          </ol>
        </div>

        <form className="composer" onSubmit={handleSendMessage}>
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <input
            id="message"
            type="text"
            placeholder="Message Aurora"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" disabled={!draftMessage.trim()}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;
