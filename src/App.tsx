import { useState, useEffect } from 'react';
import { auth, googleProvider } from './firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
    <div className="app-container">
      <header>
        <h1>WhiteChat</h1>
        <div className="user-info">
          <span>{user.displayName}</span>
          <button onClick={handleSignOut}>Sign Out</button>
        </div>
      </header>
      <main>
        <h2>Welcome to WhiteChat!</h2>
        <p>Chat functionality coming soon...</p>
      </main>
    </div>
  );
}

export default App;
