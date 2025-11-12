import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { User, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';

const systemPrompt = `You are WhiteChat, an empathetic UPSC mentor.
Provide thorough, structured guidance for civil services preparation.
Remember each learner's previous questions and answers to keep continuity.
Summaries, revision strategies, syllabus references, and balanced motivation are encouraged.
Tailor every reply to the user's unique needs while staying accurate to UPSC requirements.`;

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const generateTitle = (text: string) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'New UPSC conversation';
  }
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
};

const formatTime = (isoString?: string) => {
  if (!isoString) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoString));
};

const toIsoString = (value: unknown) => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const signInAttemptedRef = useRef(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        signInAttemptedRef.current = false;
        setChatError(null);
        return;
      }

      if (!signInAttemptedRef.current) {
        signInAttemptedRef.current = true;
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Failed to establish anonymous Firebase session:', error);
          setChatError('Unable to connect to WhiteChat. Please refresh and try again.');
          signInAttemptedRef.current = false;
        }
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      return;
    }

    const conversationsRef = collection(db, 'mentorConversations');
    const conversationsQuery = query(
      conversationsRef,
      where('ownerId', '==', user.uid),
      orderBy('updatedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      conversationsQuery,
      (snapshot) => {
        const nextConversations: Conversation[] = snapshot.docs.map((conversationDoc) => {
          const data = conversationDoc.data();
          return {
            id: conversationDoc.id,
            title: typeof data.title === 'string' ? data.title : 'New UPSC conversation',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
          };
        });
        setConversations(nextConversations);
      },
      (error) => {
        console.error('Failed to load conversations:', error);
        setChatError('Unable to load your previous sessions right now. Please try again later.');
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !activeConversationId) {
      setMessages([]);
      return;
    }

    const messagesRef = collection(db, 'mentorConversations', activeConversationId, 'messages');
    const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const nextMessages: ChatMessage[] = snapshot.docs.map((messageDoc) => {
          const data = messageDoc.data();
          return {
            id: messageDoc.id,
            role: data.role === 'assistant' ? 'assistant' : 'user',
            content: typeof data.content === 'string' ? data.content : '',
            createdAt: toIsoString(data.createdAt),
          };
        });
        setMessages(nextMessages);
      },
      (error) => {
        console.error('Failed to load messages:', error);
        setChatError('Unable to load this session. Please open a different conversation or retry.');
      },
    );

    return () => unsubscribe();
  }, [user, activeConversationId]);

  useEffect(() => {
    if (!conversations.length) {
      setActiveConversationId(null);
      return;
    }

    if (!activeConversationId || !conversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const handleNewConversation = async () => {
    if (isSending) {
      return;
    }

    if (!user) {
      if (!signInAttemptedRef.current) {
        signInAttemptedRef.current = true;
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Failed to establish anonymous Firebase session:', error);
        } finally {
          signInAttemptedRef.current = false;
        }
      }
      setChatError('Connecting to WhiteChat. Please wait a moment and try again.');
      return;
    }

    const previousConversations = conversations.slice();
    const previousMessagesState = messages.slice();
    const previousActiveId = activeConversationId;
    const conversationId = generateId();
    const nowIso = new Date().toISOString();
    const newConversation: Conversation = {
      id: conversationId,
      title: 'New UPSC conversation',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setConversations([newConversation, ...previousConversations.filter((conversation) => conversation.id !== conversationId)]);
    setActiveConversationId(conversationId);
    setMessages([]);
    setDraftMessage('');
    setChatError(null);

    try {
      await setDoc(doc(db, 'mentorConversations', conversationId), {
        ownerId: user.uid,
        title: newConversation.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to create a new conversation:', error);
      setChatError('Unable to start a new conversation right now. Please try again.');
      setConversations([...previousConversations]);
      setMessages(previousMessagesState);
      setActiveConversationId(previousActiveId ?? null);
    }
  };

  const handleSendMessage = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!draftMessage.trim() || isSending) {
      return;
    }

    if (!user) {
      if (!signInAttemptedRef.current) {
        signInAttemptedRef.current = true;
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Failed to establish anonymous Firebase session:', error);
        } finally {
          signInAttemptedRef.current = false;
        }
      }
      setChatError('Connecting to WhiteChat. Please wait a moment and try again.');
      return;
    }

    const text = draftMessage.trim();
    const previousMessages = messages.slice();
    const isFirstUserMessage = messages.length === 0;
    const historyBeforeSend = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setDraftMessage('');
    setChatError(null);
    setIsSending(true);

    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = generateId();
      try {
        await setDoc(doc(db, 'mentorConversations', conversationId), {
          ownerId: user.uid,
          title: 'New UPSC conversation',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error('Failed to create conversation for message send:', error);
        setChatError('Unable to open a new conversation. Please refresh and try again.');
        setIsSending(false);
        return;
      }
      setActiveConversationId(conversationId);
    }

    const conversationRef = doc(db, 'mentorConversations', conversationId);
    const existingConversation = conversations.find((conversation) => conversation.id === conversationId) ?? null;

    const userMessageId = generateId();
    const userCreatedAt = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: text,
      createdAt: userCreatedAt,
    };

    const conversationAfterUser: Conversation = existingConversation
      ? {
          id: existingConversation.id,
          title: isFirstUserMessage ? generateTitle(text) : existingConversation.title,
          createdAt: existingConversation.createdAt,
          updatedAt: userCreatedAt,
        }
      : {
          id: conversationId,
          title: generateTitle(text),
          createdAt: userCreatedAt,
          updatedAt: userCreatedAt,
        };

    setMessages((previous) => [...previous, userMessage]);
    setConversations((previous) => {
      const others = previous.filter((conversation) => conversation.id !== conversationId);
      return [conversationAfterUser, ...others];
    });

    try {
      await setDoc(doc(collection(db, 'mentorConversations', conversationId, 'messages'), userMessageId), {
        role: 'user',
        content: text,
        createdAt: serverTimestamp(),
      });
      await updateDoc(conversationRef, {
        title: conversationAfterUser.title,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to store user message:', error);
      setMessages(previousMessages);
      setConversations((previous) => {
        if (existingConversation) {
          const others = previous.filter((conversation) => conversation.id !== conversationId);
          return [existingConversation, ...others];
        }
        return previous.filter((conversation) => conversation.id !== conversationId);
      });
      setChatError('Unable to send your message. Please try again.');
      setIsSending(false);
      return;
    }

    const history = [...historyBeforeSend, { role: 'user', content: text }];

    let assistantContent = '';

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('Missing OpenRouter API key. Please set OPENROUTER_API_KEY or VITE_OPENROUTER_API_KEY.');
      }

      const referer = typeof window !== 'undefined' ? window.location.origin : 'https://whitechat.app';
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': referer,
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
      assistantContent =
        result?.choices?.[0]?.message?.content?.trim() ||
        'I’m ready with more UPSC guidance whenever you need it.';
    } catch (error) {
      console.error('Error sending message:', error);
      setChatError(
        error instanceof Error
          ? error.message
          : 'Something went wrong while contacting the mentor model. Please try again.',
      );
      setIsSending(false);
      return;
    }

    const assistantMessageId = generateId();
    const assistantCreatedAt = new Date().toISOString();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: assistantContent,
      createdAt: assistantCreatedAt,
    };

    const conversationAfterAssistant: Conversation = {
      id: conversationAfterUser.id,
      title: conversationAfterUser.title,
      createdAt: conversationAfterUser.createdAt,
      updatedAt: assistantCreatedAt,
    };

    const messagesBeforeAssistant = [...previousMessages, userMessage];

    setMessages((previous) => [...previous, assistantMessage]);
    setConversations((previous) => {
      const others = previous.filter((conversation) => conversation.id !== conversationAfterAssistant.id);
      return [conversationAfterAssistant, ...others];
    });

    try {
      await setDoc(doc(collection(db, 'mentorConversations', conversationId, 'messages'), assistantMessageId), {
        role: 'assistant',
        content: assistantContent,
        createdAt: serverTimestamp(),
      });
      await updateDoc(conversationRef, {
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to store mentor reply:', error);
      setMessages(messagesBeforeAssistant);
      setConversations((previous) => {
        const others = previous.filter((conversation) => conversation.id !== conversationAfterAssistant.id);
        return [conversationAfterUser, ...others];
      });
      setChatError('Your mentor reply could not be saved. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

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
          {conversations.length ? (
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
          <p className="sidebar-note">Sessions sync securely with Firebase so you can resume mentoring anywhere.</p>
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
          {messages.length ? (
            messages.map((message) => (
              <article key={message.id} className={`message message--${message.role}`}>
                <p>{message.content}</p>
                <span className="message-time">{formatTime(message.createdAt)}</span>
              </article>
            ))
          ) : (
            <div className="message-placeholder">
              <h2>Welcome to WhiteChat!</h2>
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
              <button type="submit" className="send-button" disabled={isSending || !draftMessage.trim() || !user}>
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
