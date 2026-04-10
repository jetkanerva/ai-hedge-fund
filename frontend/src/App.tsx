import { Layout } from './components/Layout';
import { Toaster } from './components/ui/sonner';
import { useAuth } from './contexts/auth-context';
import { Login } from './components/login';

export default function App() {
  const { user, dbUser, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background">Loading...</div>;
  }

  if (!user || !dbUser) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Layout />
      <Toaster />
    </>
  );
}
