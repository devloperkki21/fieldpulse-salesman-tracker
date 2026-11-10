import { useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from './api';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginScreen } from './components/LoginScreen';
import { SalesmanDashboard } from './components/SalesmanDashboard';
import type { User } from './types';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setStoredToken(null))
      .finally(() => setChecking(false));
  }, []);

  function handleLogout() {
    setStoredToken(null);
    setUser(null);
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8]">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#5D646E]">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#0D9488]" />
          Loading FieldPulse...
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSuccess={setUser} />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  return <SalesmanDashboard user={user} onLogout={handleLogout} />;
}

export default App;

