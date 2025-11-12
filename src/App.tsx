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

  const formatDay = (isoString: string) => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    if (isSameDay(date, today)) {
      return `Today ${formatTime(isoString)}`;
    }

    if (isSameDay(date, yesterday)) {
      return `Yesterday ${formatTime(isoString)}`;
    }

    return formatter.format(date);
  };

  const statusTime = useMemo(() => {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
  }, []);

  const companionProfile = useMemo(
    () => ({
      name: 'Aurora Lane',
      role: 'Product Designer',
      avatar:
        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=facearea&facepad=2&w=160&h=160&q=80',
    }),
    []
  );

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
      <div className="device-frame">
        <header className="status-bar" aria-label="Device status">
          <span className="status-time">{statusTime}</span>
          <div className="status-icons" aria-hidden>
            <span className="status-icon status-icon--signal" />
            <span className="status-icon status-icon--wifi" />
            <span className="status-icon status-icon--battery" />
          </div>
        </header>

        <header className="conversation-header">
          <button
            type="button"
            className="conversation-header__button conversation-header__button--back"
            onClick={handleSignOut}
          >
            Messages
          </button>
          <div className="conversation-header__details">
            <img
              src={companionProfile.avatar}
              alt={`${companionProfile.name}'s avatar`}
            />
            <div>
              <span className="conversation-header__name">{companionProfile.name}</span>
              <span className="conversation-header__status">iMessage</span>
            </div>
          </div>
          <button
            type="button"
            className="conversation-header__button conversation-header__button--info"
            aria-label="Conversation details"
          >
            i
          </button>
        </header>

        <main className="conversation" role="log" aria-live="polite">
          <ol className="thread">
            {(() => {
              const items: JSX.Element[] = [];
              let previousDayKey: string | null = null;

              messages.forEach((message) => {
                const dayKey = new Date(message.timestamp).toDateString();
                const dayLabel = formatDay(message.timestamp);

                if (dayKey !== previousDayKey) {
                  items.push(
                    <li key={`${message.id}-divider`} className="thread-divider">
                      <span>{dayLabel}</span>
                    </li>
                  );
                  previousDayKey = dayKey;
                }

                items.push(
                  <li
                    key={message.id}
                    className={`bubble bubble--${message.author}`}
                  >
                    <p>{message.content}</p>
                    <span className="bubble__time">{formatTime(message.timestamp)}</span>
                  </li>
                );
              });

              if (isCompanionTyping) {
                items.push(
                  <li key="typing" className="bubble bubble--companion" role="status">
                    <div className="typing-dots" aria-label="Typing">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="bubble__time">Now</span>
                  </li>
                );
              }

              items.push(<div ref={scrollAnchorRef} key="anchor" />);
              return items;
            })()}
          </ol>
        </main>

        <form className="composer" onSubmit={handleSendMessage}>
          <button type="button" className="composer__action" aria-label="Show attachments">
            ➕
          </button>
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <input
            id="message"
            type="text"
            placeholder="iMessage"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="composer__send" disabled={!draftMessage.trim()}>
            Send
          </button>
        </form>
      </div>
      <p className="signed-in">Signed in as {user.displayName ?? 'WhiteChat Pro'}</p>
    </div>
  );
}

export default App;
