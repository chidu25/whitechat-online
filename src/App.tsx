import { useState, useEffect } from 'react';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';

function App() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in:', error);
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
        <button onClick={handleGoogleSignIn} className="signin-button">
          Sign in with Google
        </button>
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
