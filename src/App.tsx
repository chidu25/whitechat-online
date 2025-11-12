import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { auth, googleProvider } from './firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

type MessageStatus = 'sent' | 'delivered' | 'read';

type ChatMessage = {
  id: string;
  author: 'self' | 'companion';
  content: string;
  timestamp: string;
  status?: MessageStatus;
};

const statusLabels: Record<MessageStatus, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

const TypingIndicator = () => (
  <div className="typing-indicator" aria-live="polite" aria-label="Companion is typing">
    <span />
    <span />
    <span />
  </div>
);

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: '1',
      author: 'companion',
      content:
        "Morning! I just polished the hero illustrations. Want me to share the motion study in Figma?",
      timestamp: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    },
    {
      id: '2',
      author: 'self',
      content:
        "Absolutely. Let's add a touch more depth on the landing fold and keep the CTA crisp.",
      timestamp: new Date(Date.now() - 1000 * 60 * 39).toISOString(),
      status: 'read',
    },
    {
      id: '3',
      author: 'companion',
      content:
        "Noted. I'm also prepping an interactive walkthrough so the investors feel the flow instantly.",
      timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
    },
  ]);
  const [isCompanionTyping, setIsCompanionTyping] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const pendingTimeout = useRef<number | null>(null);

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
        } else if (error.code === 'auth/cancelled-popup-request') {
          // Ignore silently cancelled popup requests to avoid confusing the user.
          return;
        } else {
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
  }, [messages.length, isCompanionTyping]);

  useEffect(() => {
    return () => {
      if (pendingTimeout.current) {
        window.clearTimeout(pendingTimeout.current);
      }
    };
  }, []);

  const formatTime = (isoString: string) => {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(isoString));
  };

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftMessage.trim()) {
      return;
    }

    const trimmed = draftMessage.trim();
    const now = new Date();

    setMessages((prev) => [
      ...prev,
      {
        id: `${now.getTime()}-self`,
        author: 'self',
        content: trimmed,
        timestamp: now.toISOString(),
        status: 'sent',
      },
    ]);

    setDraftMessage('');

    if (pendingTimeout.current) {
      window.clearTimeout(pendingTimeout.current);
    }

    setIsCompanionTyping(true);
    pendingTimeout.current = window.setTimeout(() => {
      const replyTime = new Date();
      setMessages((prev) => [
        ...prev,
        {
          id: `${replyTime.getTime()}-companion`,
          author: 'companion',
          content:
            'On it. I will queue the prototype for the deck and ship you a build to play with after lunch.',
          timestamp: replyTime.toISOString(),
        },
      ]);
      setIsCompanionTyping(false);
      pendingTimeout.current = null;
    }, 1700);
  };

  const companionProfile = useMemo(
    () => ({
      name: 'Aurora Lane',
      role: 'Product Designer',
      status: 'Designing the investor preview',
      avatar:
        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
    }),
    []
  );

  const signedInAvatar =
    user?.photoURL ??
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=facearea&facepad=3&w=256&h=256&q=80';

  if (!user) {
    return (
      <div className="auth-container">
        <h1>WhiteChat Online</h1>
        <button
          onClick={handleGoogleSignIn}
          className="signin-button"
          disabled={isSigningIn}
        >
          {isSigningIn ? 'Opening Google…' : 'Sign in with Google'}
        </button>
        {authError ? <p className="auth-error">{authError}</p> : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="profile-panel">
        <div className="profile-card">
          <div className="profile-avatar">
            <img src={signedInAvatar} alt={user.displayName ?? 'Signed-in user'} />
          </div>
          <div className="profile-meta">
            <span className="profile-label">You</span>
            <h2>{user.displayName ?? 'WhiteChat Pro'}</h2>
            <p>{user.email ?? 'Connected securely'}</p>
          </div>
        </div>
        <button className="signout-button" onClick={handleSignOut}>
          Sign out
        </button>
      </aside>
      <section className="conversation-panel">
        <header className="conversation-header">
          <div className="companion">
            <div className="companion-avatar">
              <img src={companionProfile.avatar} alt={`${companionProfile.name}'s avatar`} />
              <span className="presence" aria-hidden="true" />
            </div>
            <div className="companion-meta">
              <span className="companion-label">Product Review</span>
              <h1>{companionProfile.name}</h1>
              <p>{companionProfile.role}</p>
            </div>
          </div>
          <div className="header-actions">
            <span className="status-chip">{companionProfile.status}</span>
            <button className="header-button" type="button" aria-label="Start video call">
              Video Call
            </button>
          </div>
        </header>
        <div className="conversation-body">
          <div className="timeline-divider">
            <span>Today</span>
          </div>
          <div className="messages" role="list">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message message--${message.author}`}
                role="listitem"
              >
                <div className="message-bubble">
                  <p>{message.content}</p>
                  <div className="message-meta">
                    <time dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
                    {message.author === 'self' && message.status ? (
                      <span className={`message-status message-status--${message.status}`}>
                        {statusLabels[message.status]}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
            {isCompanionTyping ? (
              <div className="message message--companion message--typing" role="status">
                <div className="message-bubble">
                  <TypingIndicator />
                </div>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>
        </div>
        <form className="composer" onSubmit={handleSendMessage}>
          <div className="composer-field">
            <label htmlFor="message" className="sr-only">
              Message
            </label>
            <input
              id="message"
              type="text"
              placeholder="Compose something brilliant…"
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="composer-actions">
            <button type="submit" disabled={!draftMessage.trim()}>
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default App;
